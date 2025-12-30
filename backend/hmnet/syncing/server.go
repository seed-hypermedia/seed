package syncing

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing/rbsr"
	"slices"
	"strings"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	rpcpeer "google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"

	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/unsafeutil"
)

// Server is the RPC handler for the syncing service.
type Server struct {
	db      *sqlitex.Pool
	index   *blob.Index
	bitswap bitswap
}

// NewServer creates a new RPC handler instance.
// It has to be further registered with the actual [grpc.Server].
func NewServer(db *sqlitex.Pool, index *blob.Index, bswap bitswap) *Server {
	return &Server{
		db:      db,
		index:   index,
		bitswap: bswap,
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

	if err := s.index.PutMany(ctx, downloaded); err != nil {
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
	store, err := s.loadStore(ctx, in.Filters)
	if err != nil {
		return nil, err
	}

	ne, err := rbsr.NewSession(store, 50000)
	if err != nil {
		return nil, err
	}

	out, err := ne.Reconcile(in.Ranges)
	if err != nil {
		return nil, err
	}
	return &p2p.ReconcileBlobsResponse{
		Ranges: out,
	}, nil
}

func (s *Server) loadStore(ctx context.Context, filters []*p2p.Filter) (rbsr.Store, error) {
	store := newAuthorizedStore()

	dkeys := make(colx.HashSet[DiscoveryKey], len(filters))
	requestedIRIs := make([]blob.IRI, 0, len(filters))
	for _, f := range filters {
		f.Resource = strings.TrimSuffix(f.Resource, "/")
		iri := blob.IRI(f.Resource)
		dkeys.Put(DiscoveryKey{
			IRI:       iri,
			Recursive: f.Recursive,
		})
		requestedIRIs = append(requestedIRIs, iri)
	}

	// Get authorized spaces for the calling peer.
	pid, err := getRemoteID(ctx)
	var authorizedSpaces []core.Principal
	if err == nil {
		authorizedSpaces, err = s.index.GetAuthorizedSpacesForPeer(ctx, pid, requestedIRIs)
		if err != nil {
			return nil, err
		}
	}

	if err := s.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, dkeys, store)
	}); err != nil {
		return nil, err
	}

	if err := store.Seal(); err != nil {
		return nil, err
	}

	store = store.WithFilter(authorizedSpaces)

	return store, nil
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
