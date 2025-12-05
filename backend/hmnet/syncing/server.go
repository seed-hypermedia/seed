package syncing

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"seed/backend/blob"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing/rbsr"
	"strings"
	"time"

	"github.com/ipfs/boxo/blockstore"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
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
	blobs   blockstore.Blockstore
	bitswap bitswap
}

// NewServer creates a new RPC handler instance.
// It has to be further registered with the actual [grpc.Server].
func NewServer(db *sqlitex.Pool, bs blockstore.Blockstore, bswap bitswap) *Server {
	return &Server{
		db:      db,
		blobs:   bs,
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

	// We don't want to wait forever for bitswap to fetch all the blobs,
	// so if we haven't downloaded all of them yet, but we stopped receiving new data
	// for longer than idle timeout — we'll stop waiting.
	const idleTimeout = 40 * time.Second
	idle := time.NewTimer(idleTimeout)
	defer idle.Stop()

Loop:
	for {
		select {
		case blk, ok := <-ch:
			if !ok {
				break Loop
			}

			idle.Reset(idleTimeout)
			downloaded[wantsIdx[blk.Cid()]] = blk
			prog.BlobsProcessed++
			if err := stream.Send(prog); err != nil {
				return err
			}
		case <-idle.C:
			// Account for failures and stop waiting.
			prog.BlobsFailed = int32(len(wants)) - prog.BlobsProcessed //nolint:gosec
			prog.BlobsProcessed = int32(len(wants))                    //nolint:gosec
			if err := stream.Send(prog); err != nil {
				return err
			}
			break Loop
		}
	}

	// Compact the downloaded blobs to remove any nils (the failed blobs).
	{
		var n int
		for _, x := range downloaded {
			if x == nil {
				continue
			}
			downloaded[n] = x
			n++
		}
		downloaded = downloaded[:n]
	}

	if len(downloaded) == 0 {
		return nil
	}

	if err := s.blobs.PutMany(ctx, downloaded); err != nil {
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
	store := rbsr.NewSliceStore()

	dkeys := make(colx.HashSet[DiscoveryKey], len(filters))
	for _, f := range filters {
		f.Resource = strings.TrimSuffix(f.Resource, "/")
		dkeys.Put(DiscoveryKey{
			IRI:       blob.IRI(f.Resource),
			Recursive: f.Recursive,
		})
	}

	if err := s.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, dkeys, store)
	}); err != nil {
		return nil, err
	}

	return store, store.Seal()
}
