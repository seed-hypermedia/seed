package syncing

import (
	"context"
	"seed/backend/blob"
	resources "seed/backend/genproto/documents/v3alpha"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing/rbsr"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"seed/backend/util/colx"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Server is the RPC handler for the syncing service.
type Server struct {
	db *sqlitex.Pool
}

// NewServer creates a new RPC handler instance.
// It has to be further registered with the actual [grpc.Server].
func NewServer(db *sqlitex.Pool) *Server {
	return &Server{
		db: db,
	}
}

// RegisterServer registers the instance with the gRPC server.
func (s *Server) RegisterServer(srv grpc.ServiceRegistrar) {
	p2p.RegisterSyncingServer(srv, s)
}

func (s *Server) FetchBlobs(in *p2p.FetchBlobsRequest, stream grpc.ServerStreamingServer[resources.SyncingProgress]) error {
	return status.Error(codes.Unimplemented, "TODO: FetchBlobs is not implemented yet!!!")
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
