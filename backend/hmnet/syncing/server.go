package syncing

import (
	"context"
	"fmt"
	"seed/backend/blob"
	resources "seed/backend/genproto/documents/v3alpha"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing/rbsr"
	"strings"
	"time"

	"github.com/ipfs/boxo/blockstore"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"google.golang.org/grpc"

	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
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

var qGetBlobs = dqb.Str(`
SELECT distinct
multihash,
codec
FROM blobs
WHERE codec IN (SELECT value from json_each(:codec_json))
AND multihash IN (SELECT value from json_each(:multihash_json))
`)

func (s *Server) FetchBlobs(in *p2p.FetchBlobsRequest, stream grpc.ServerStreamingServer[resources.SyncingProgress]) error {
	ctx, cancel := context.WithCancel(stream.Context())
	defer cancel()
	prog := NewDiscoveryProgress()
	prog.StartNotifier(ctx, 100*time.Millisecond)
	prog.Notify()
	localHaves := make(colx.HashSet[cid.Cid], len(in.Cids))
	codecs, mhashes := []string{}, []string{}
	allWants := make([]cid.Cid, 0, len(in.Cids))
	wants := make([]cid.Cid, 0, len(in.Cids))
	for _, cstr := range in.Cids {
		cID, err := cid.Parse(cstr)
		if err != nil {
			return fmt.Errorf("failed to parse cid '%s': %w", cstr, err)
		}
		mhashes = append(mhashes, cID.Hash().String())
		codecs = append(codecs, fmt.Sprintf("%d", cID.Type()))
		allWants = append(allWants, cID)
	}
	codecJson := "[" + strings.Join(codecs, ",") + "]"
	mhashJson := "[" + strings.Join(mhashes, ",") + "]"
	if err := s.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.ExecTransient(conn, qGetBlobs(), func(stmt *sqlite.Stmt) error {
			mhash := stmt.ColumnBytes(0)
			codec := stmt.ColumnInt64(1)
			cID := cid.NewCidV1(uint64(codec), mhash)
			localHaves.Put(cID)
			return nil
		}, mhashJson, codecJson)
	}); err != nil {
		return err
	}
	for _, want := range allWants {
		if !localHaves.Has(want) {
			prog.BlobsDiscovered.Add(1)
			progIn := &resources.SyncingProgress{
				BlobsDiscovered: prog.BlobsDiscovered.Load(),
				BlobsDownloaded: prog.BlobsDownloaded.Load(),
				BlobsFailed:     prog.BlobsFailed.Load(),
				PeersFailed:     prog.PeersFailed.Load(),
				PeersFound:      prog.PeersFound.Load(),
				PeersSyncedOk:   prog.PeersSyncedOK.Load(),
			}
			if err := stream.Send(progIn); err != nil {
				return err
			}
			wants = append(wants, want)
		}
	}

	if len(wants) == 0 {
		return nil
	}

	MSyncingWantedBlobs.WithLabelValues("syncing").Add(float64(len(wants)))
	defer MSyncingWantedBlobs.WithLabelValues("syncing").Sub(float64(len(wants)))

	downloaded := make([]blocks.Block, len(wants))
	bswap := s.bitswap.NewSession(ctx)
	for i, blkID := range wants {
		blk, err := bswap.GetBlock(ctx, blkID)
		if err != nil {
			prog.BlobsFailed.Add(1)
		} else {
			prog.BlobsDownloaded.Add(1)
			downloaded[i] = blk
		}
		progIn := &resources.SyncingProgress{
			BlobsDiscovered: prog.BlobsDiscovered.Load(),
			BlobsDownloaded: prog.BlobsDownloaded.Load(),
			BlobsFailed:     prog.BlobsFailed.Load(),
			PeersFailed:     prog.PeersFailed.Load(),
			PeersFound:      prog.PeersFound.Load(),
			PeersSyncedOk:   prog.PeersSyncedOK.Load(),
		}
		if err := stream.Send(progIn); err != nil {
			return err
		}
	}

	if err := s.blobs.PutMany(ctx, downloaded); err != nil {
		return fmt.Errorf("failed to put blobs: %w", err)
	}
	prog.PeersSyncedOK.Add(1)
	progIn := &resources.SyncingProgress{
		BlobsDiscovered: prog.BlobsDiscovered.Load(),
		BlobsDownloaded: prog.BlobsDownloaded.Load(),
		BlobsFailed:     prog.BlobsFailed.Load(),
		PeersFailed:     prog.PeersFailed.Load(),
		PeersFound:      prog.PeersFound.Load(),
		PeersSyncedOk:   prog.PeersSyncedOK.Load(),
	}

	return stream.Send(progIn)
}

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
