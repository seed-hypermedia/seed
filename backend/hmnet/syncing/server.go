package syncing

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"runtime"
	"seed/backend/blob"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/logging"
	"slices"
	"strings"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/peer"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	rpcpeer "google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"

	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/longrunning"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/unsafeutil"
)

// Server is the RPC handler for the syncing service.
type Server struct {
	db               *sqlitex.Pool
	index            blobIndex
	bitswap          bitswap
	log              *zap.Logger
	reconcileLimiter *inboundReconcileLimiter
}

type blobIndex interface {
	PutMany(context.Context, []blocks.Block) error
	GetAuthorizedSpacesForPeer(context.Context, peer.ID, []blob.IRI) ([]core.Principal, error)
	ReindexInfo() blob.ReindexInfo
}

// NewServer creates a new RPC handler instance.
// It has to be further registered with the actual [grpc.Server].
func NewServer(db *sqlitex.Pool, index *blob.Index, bswap bitswap, maxInboundReconciles int, inboundReconcileWait time.Duration) *Server {
	// Keep the maintained RBSR index current: every blob indexed (via Put /
	// PutMany) patches the materialized scopes it joins, in the same write
	// transaction, so reconciliation serves a fresh set without rebuilding it.
	index.SetIndexedHook(MaintainRBSRIndex)

	return &Server{
		db:               db,
		index:            index,
		bitswap:          bswap,
		log:              logging.New("seed/network", logging.GetLogLevel("seed/network").String()),
		reconcileLimiter: newInboundReconcileLimiter(maxInboundReconciles, inboundReconcileWait),
	}
}

const defaultInboundReconcileWait = 3 * time.Second

type inboundReconcileLimiter struct {
	sem   chan struct{}
	wait  time.Duration
	limit int
}

func newInboundReconcileLimiter(limit int, wait time.Duration) *inboundReconcileLimiter {
	if limit < 0 {
		MReconcileServerLimiterLimit.Set(-1)
		return nil
	}
	if limit == 0 {
		limit = 2 * runtime.GOMAXPROCS(0)
		if limit < 2 {
			limit = 2
		}
	}
	if wait <= 0 {
		wait = defaultInboundReconcileWait
	}
	MReconcileServerLimiterLimit.Set(float64(limit))
	return &inboundReconcileLimiter{
		sem:   make(chan struct{}, limit),
		wait:  wait,
		limit: limit,
	}
}

func (s *Server) acquireReconcileSlot(ctx context.Context) (func(), error) {
	if s.reconcileLimiter == nil {
		MReconcileServerLimiterWaitSeconds.Observe(0)
		MReconcileServerLimiterAcceptedTotal.Inc()
		return func() {}, nil
	}
	return s.reconcileLimiter.acquire(ctx)
}

func (l *inboundReconcileLimiter) acquire(ctx context.Context) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}

	start := time.Now()
	select {
	case l.sem <- struct{}{}:
		MReconcileServerLimiterWaitSeconds.Observe(0)
		MReconcileServerLimiterAcceptedTotal.Inc()
		MReconcileServerLimiterInFlight.Inc()
		return func() {
			<-l.sem
			MReconcileServerLimiterInFlight.Dec()
		}, nil
	default:
	}

	MReconcileServerLimiterWaiting.Inc()
	defer MReconcileServerLimiterWaiting.Dec()

	timer := time.NewTimer(l.wait)
	defer timer.Stop()

	select {
	case l.sem <- struct{}{}:
		MReconcileServerLimiterWaitSeconds.Observe(time.Since(start).Seconds())
		MReconcileServerLimiterAcceptedTotal.Inc()
		MReconcileServerLimiterInFlight.Inc()
		return func() {
			<-l.sem
			MReconcileServerLimiterInFlight.Dec()
		}, nil
	case <-timer.C:
		MReconcileServerLimiterWaitSeconds.Observe(time.Since(start).Seconds())
		MReconcileServerLimiterRejectedTotal.Inc()
		return nil, status.Errorf(codes.ResourceExhausted, "reconcile server busy: %d concurrent requests, waited %s", l.limit, l.wait)
	case <-ctx.Done():
		MReconcileServerLimiterWaitSeconds.Observe(time.Since(start).Seconds())
		return nil, status.FromContextError(ctx.Err()).Err()
	}
}

// RegisterServer registers the instance with the gRPC server.
func (s *Server) RegisterServer(srv grpc.ServiceRegistrar) {
	p2p.RegisterSyncingServer(srv, s)
}

// AnnounceBlobs fetches blobs from the peer that are not present locally.
func (s *Server) AnnounceBlobs(in *p2p.AnnounceBlobsRequest, stream grpc.ServerStreamingServer[p2p.AnnounceBlobsProgress]) error {
	ctx := stream.Context()

	const maxBlobsPerPush = 200_000 // Arbitrary limit to prevent abuse.

	if len(in.Cids) == 0 {
		return nil
	}

	if len(in.Cids) > maxBlobsPerPush {
		return status.Errorf(codes.InvalidArgument, "too many blobs announced: must be <= %d", maxBlobsPerPush)
	}

	allAnnounced := make([]cid.Cid, 0, len(in.Cids))
	wants := make([]cid.Cid, 0, len(allAnnounced))

	// Storing indexes of wanted elements as in the original list,
	// to collate the downloaded blobs in the same order afterwards.
	wantsIdx := make(map[cid.Cid]int, len(allAnnounced))

	// Process the input list once here, decoding all the CIDs,
	// collecting all of them into one JSON array,
	// sending it to SQLite to only return indexes of those elements of the array that we don't have locally,
	// which we then track as wants.
	{
		const overheadPerCID = 38*2 + 4 // 38 bytes per binary CID * 2 for hex encoding + 4 for JSON quotes and braces.
		mhashJSON := bytes.NewBuffer(make([]byte, 0, overheadPerCID*len(in.Cids)))
		hexEnc := hex.NewEncoder(mhashJSON)
		for i, cstr := range in.Cids {
			c, err := cid.Decode(cstr)
			if err != nil {
				return fmt.Errorf("failed to parse cid '%s': %w", cstr, err)
			}

			allAnnounced = append(allAnnounced, c)

			if i == 0 {
				mhashJSON.WriteByte('[')
			}

			mhashJSON.WriteByte('"')
			if _, err := hexEnc.Write(c.Hash()); err != nil {
				return err
			}
			mhashJSON.WriteByte('"')

			if i < len(in.Cids)-1 {
				mhashJSON.WriteByte(',')
			} else {
				mhashJSON.WriteByte(']')
			}
		}

		if err := s.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, qFilterWantedBlobsIdx(), func(stmt *sqlite.Stmt) error {
				idx := stmt.ColumnInt(0)
				wantsIdx[allAnnounced[idx]] = len(wants)
				wants = append(wants, allAnnounced[idx])
				return nil
			}, unsafeutil.StringFromBytes(mhashJSON.Bytes()))
		}); err != nil {
			return err
		}
	}

	prog := &p2p.AnnounceBlobsProgress{
		BlobsAnnounced: int32(len(allAnnounced)),              //nolint:gosec
		BlobsKnown:     int32(len(allAnnounced) - len(wants)), //nolint:gosec
		BlobsWanted:    int32(len(wants)),                     //nolint:gosec
	}

	if len(wants) > 0 && s.index.ReindexInfo().State == blob.ReindexStateInProgress {
		return status.Error(codes.Unavailable, "server is reindexing blobs; retry later")
	}

	if err := stream.Send(prog); err != nil {
		return err
	}

	if len(wants) == 0 {
		return nil
	}

	MSyncingWantedBlobs.WithLabelValues("syncing").Add(float64(len(wants)))
	defer MSyncingWantedBlobs.WithLabelValues("syncing").Sub(float64(len(wants)))

	downloaded := make([]blocks.Block, len(wants))
	ch, err := s.bitswap.NewSession(ctx).GetBlocks(ctx, wants)
	if err != nil {
		return fmt.Errorf("failed to initiate bitswap session: %w", err)
	}

	download := func() error {
		const idleTimeout = 40 * time.Second
		t := time.NewTimer(idleTimeout)
		defer t.Stop()

		for {
			select {
			case blk, ok := <-ch:
				if !ok {
					return nil
				}

				t.Reset(idleTimeout)
				downloaded[wantsIdx[blk.Cid()]] = blk
				prog.BlobsProcessed++
				if err := stream.Send(prog); err != nil {
					return err
				}
			case <-t.C:
				// Account for failures and stop waiting.
				prog.BlobsFailed = int32(len(wants)) - prog.BlobsProcessed //nolint:gosec
				prog.BlobsProcessed = int32(len(wants))                    //nolint:gosec
				return stream.Send(prog)
			}
		}
	}

	if err := download(); err != nil {
		return fmt.Errorf("failed to download blobs: %w", err)
	}

	// Remove nils — i.e. blobs we couldn't download.
	downloaded = slices.DeleteFunc(downloaded, func(x blocks.Block) bool { return x == nil })

	if len(downloaded) == 0 {
		return nil
	}

	fields := []zap.Field{
		zap.Int("announcedCount", len(allAnnounced)),
		zap.Int("wantedCount", len(wants)),
		zap.Int("downloadedCount", len(downloaded)),
	}
	if pid, err := getRemoteID(ctx); err == nil {
		fields = append(fields, zap.String("peerID", pid.String()))
	}
	tracker := longrunning.Start(s.log, "AnnounceBlobsWrite", 30*time.Second, fields...)
	defer func() {
		tracker.Finish(nil)
	}()

	if err := s.index.PutMany(ctx, downloaded); err != nil {
		tracker.Finish(err)
		return fmt.Errorf("failed to put blobs: %w", err)
	}

	return nil
}

// This query will return the *indexes* from the input array
// for those elements that we don't have in the database.
var qFilterWantedBlobsIdx = dqb.Str(`
	SELECT j.key
	FROM json_each(:mhash_json) j
	LEFT JOIN blobs b INDEXED BY blobs_metadata_by_hash ON b.multihash = unhex(j.value) AND b.size >= 0
	WHERE b.multihash IS NULL;
`)

// ReconcileBlobs reconciles a set of blobs from the initiator. Finds the difference from what we have.
func (s *Server) ReconcileBlobs(ctx context.Context, in *p2p.ReconcileBlobsRequest) (*p2p.ReconcileBlobsResponse, error) {
	release, err := s.acquireReconcileSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	totalStart := time.Now()
	rangesBucket := bucketCountLog2(len(in.Ranges))
	filtersBucket := bucketCountLog2(len(in.Filters))
	defer func() {
		MReconcileServerTotalSeconds.WithLabelValues(rangesBucket, filtersBucket).Observe(time.Since(totalStart).Seconds())
	}()
	MReconcileServerFilterSize.Observe(float64(len(in.Filters)))

	store, err := s.loadStore(ctx, in.Filters)
	if err != nil {
		return nil, err
	}
	MReconcileServerStoreSize.Observe(float64(store.Size()))

	sessionStart := time.Now()
	ne, err := rbsr.NewSession(store, rbsrMsgSizeBytes)
	MReconcileServerPhaseSeconds.WithLabelValues("rbsr_session").Observe(time.Since(sessionStart).Seconds())
	if err != nil {
		return nil, err
	}

	reconcileStart := time.Now()
	out, err := ne.Reconcile(in.Ranges)
	MReconcileServerPhaseSeconds.WithLabelValues("rbsr_reconcile").Observe(time.Since(reconcileStart).Seconds())
	if err != nil {
		return nil, err
	}
	return &p2p.ReconcileBlobsResponse{
		Ranges: out,
	}, nil
}

func (s *Server) loadStore(ctx context.Context, filters []*p2p.Filter) (rbsr.Store, error) {
	dkeys := make(colx.HashSet[DiscoveryKey], len(filters))
	requestedIRIs := make([]blob.IRI, 0, len(filters))
	for _, f := range filters {
		f.Resource = strings.TrimSuffix(f.Resource, "/")
		iri := blob.IRI(f.Resource)
		dkeys.Put(DiscoveryKey{
			IRI:       iri,
			Recursive: f.Recursive,
			DepthOne:  f.DepthOne,
			BlobTypes: BlobTypesString(f.Types),
		})
		requestedIRIs = append(requestedIRIs, iri)
	}

	// Get authorized spaces for the calling peer.
	pid, err := getRemoteID(ctx)
	var authorizedSpaces []core.Principal
	authStart := time.Now()
	if err == nil {
		authorizedSpaces, err = s.index.GetAuthorizedSpacesForPeer(ctx, pid, requestedIRIs)
		if err != nil {
			MReconcileServerPhaseSeconds.WithLabelValues("auth_resolve").Observe(time.Since(authStart).Seconds())
			return nil, err
		}
	}
	MReconcileServerPhaseSeconds.WithLabelValues("auth_resolve").Observe(time.Since(authStart).Seconds())

	loadStart := time.Now()
	defer func() {
		MReconcileServerPhaseSeconds.WithLabelValues("load_store").Observe(time.Since(loadStart).Seconds())
	}()

	// Serve from the maintained index, unless a reindex is in flight (the derived
	// tables may be torn down mid-reindex). Any error in the index path falls back
	// to the authoritative legacy rebuild, so a problem in the maintained index
	// can never break sync.
	if st := s.index.ReindexInfo().State; st != blob.ReindexStatePending && st != blob.ReindexStateInProgress {
		store, err := s.loadStoreFromIndex(ctx, dkeys, authorizedSpaces, protocolVersionFromContext(ctx))
		if err == nil {
			return store, nil
		}
		s.log.Warn("RBSRIndexServeFallback", zap.Error(err))
	}

	return s.loadStoreLegacy(ctx, dkeys, authorizedSpaces)
}

// loadStoreLegacy builds the store by rebuilding the full set via collectBlobs —
// the original, authoritative path. It writes only TEMP tables (rbsr_blobs /
// rbsr_iris), so WithSaveTempOnly avoids the main-DB writer mutex.
func (s *Server) loadStoreLegacy(ctx context.Context, dkeys colx.HashSet[DiscoveryKey], authorizedSpaces []core.Principal) (rbsr.Store, error) {
	store := newAuthorizedStore()
	if err := s.db.WithSaveTempOnly(ctx, func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, dkeys, store)
	}); err != nil {
		return nil, err
	}
	if err := store.Seal(); err != nil {
		return nil, err
	}
	return store.WithFilter(authorizedSpaces), nil
}

// loadStoreFromIndex serves from the maintained index: materialize each scope
// once (the only place the expensive collectBlobs closure runs), then build the
// tree-backed store from the union of persisted rows. The incremental oracle
// keeps the set current so reconciliation no longer rebuilds it per round.
func (s *Server) loadStoreFromIndex(ctx context.Context, dkeys colx.HashSet[DiscoveryKey], authorizedSpaces []core.Principal, protocolVersion string) (rbsr.Store, error) {
	store := newAuthorizedTreeStore()
	if err := s.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		scopeIDs := make([]int64, 0, len(dkeys))
		for dkey := range dkeys {
			id, materialized, err := resolveScope(conn, dkey, protocolVersion)
			if err != nil {
				return err
			}
			if !materialized {
				if err := materializeScope(conn, id, dkey); err != nil {
					return err
				}
			}
			scopeIDs = append(scopeIDs, id)
		}
		return buildStoreFromScopes(conn, scopeIDs, protocolVersion, store)
	}); err != nil {
		return nil, err
	}

	if err := store.Seal(); err != nil {
		return nil, err
	}

	return store.WithFilter(authorizedSpaces), nil
}

// getRemoteID extracts the remote peer ID from the gRPC context.
func getRemoteID(ctx context.Context) (peer.ID, error) {
	info, ok := rpcpeer.FromContext(ctx)
	if !ok {
		return "", fmt.Errorf("no peer info in context")
	}

	pid, err := peer.Decode(info.Addr.String())
	if err != nil {
		return "", err
	}

	return pid, nil
}

// bucketCountLog2 maps a non-negative count into a coarse log2 bucket label
// suitable for low-cardinality Prometheus dimensions. The fixed-string return
// values keep the cardinality bounded regardless of input magnitude.
func bucketCountLog2(n int) string {
	switch {
	case n <= 0:
		return "0"
	case n == 1:
		return "1"
	case n <= 3:
		return "2-3"
	case n <= 9:
		return "4-9"
	case n <= 31:
		return "10-31"
	case n <= 99:
		return "32-99"
	default:
		return "100+"
	}
}
