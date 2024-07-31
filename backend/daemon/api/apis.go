package api

import (
	"context"
	"fmt"
	"seed/backend/core"
	activity "seed/backend/daemon/api/activity/v1alpha"
	daemon "seed/backend/daemon/api/daemon/v1alpha"
	documentsv3 "seed/backend/daemon/api/documents/v3alpha"
	entities "seed/backend/daemon/api/entities/v1alpha"
	networking "seed/backend/daemon/api/networking/v1alpha"
	"seed/backend/daemon/index"
	"seed/backend/hyper"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/pkg/future"
	"seed/backend/syncing"

	"crawshaw.io/sqlite/sqlitex"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc"
)

// Server combines all the daemon API services into one thing.
type Server struct {
	Daemon      *daemon.Server
	Networking  *networking.Server
	Entities    *entities.Server
	Activity    *activity.Server
	Syncing     *syncing.Service
	DocumentsV3 *documentsv3.Server
}

type Storage interface {
	DB() *sqlitex.Pool
	KeyStore() core.KeyStore
	Migrate() error
	Device() core.KeyPair
}

// New creates a new API server.
func New(
	ctx context.Context,
	repo Storage,
	db *sqlitex.Pool,
	blobs *hyper.Storage,
	node *mttnet.Node,
	wallet daemon.Wallet,
	sync *syncing.Service,
	LogLevel string,
) Server {
	doSync := func() error {
		go func() {
			if err := sync.SyncAllAndLog(context.Background()); err != nil {
				panic("bug or fatal error during sync " + err.Error())
			}
		}()

		return nil

	}

	idx := index.NewIndex(db, logging.New("seed/index", LogLevel))

	return Server{
		Activity:    activity.NewServer(db),
		Daemon:      daemon.NewServer(repo, blobs, wallet, doSync),
		Networking:  networking.NewServer(blobs, node, db),
		Entities:    entities.NewServer(blobs, &lazyDiscoverer{}),
		DocumentsV3: documentsv3.NewServer(repo.KeyStore(), idx, db),
		Syncing:     sync,
	}
}

// Register API services on the given gRPC server.
func (s Server) Register(srv *grpc.Server) {
	s.Daemon.RegisterServer(srv)
	s.Activity.RegisterServer(srv)
	s.Networking.RegisterServer(srv)
	s.Entities.RegisterServer(srv)
	s.DocumentsV3.RegisterServer(srv)
}

type lazyDiscoverer struct {
	net *future.ReadOnly[*mttnet.Node]
}

// DiscoverObject attempts to discover a given Seed Object with an optional version specified.
// If no version is specified it tries to find whatever is possible.
func (ld *lazyDiscoverer) DiscoverObject(ctx context.Context, obj hyper.EntityID, v hyper.Version) error {
	return fmt.Errorf("TODO(hm24): implement discovery")

	// svc, err := ld.sync.Await(ctx)
	// if err != nil {
	// 	return err
	// }

	// return svc.DiscoverObject(ctx, obj, v)
}

// ProvideCID notifies the providing system to provide the given CID on the DHT.
func (ld *lazyDiscoverer) ProvideCID(c cid.Cid) error {
	node, ok := ld.net.Get()
	if !ok {
		return fmt.Errorf("p2p node is not yet initialized")
	}

	return node.ProvideCID(c)
}

// Connect connects to a remote peer. Necessary here for the grpc server to add a site
// that needs to connect to the site under the hood.
func (ld *lazyDiscoverer) Connect(ctx context.Context, peerInfo peer.AddrInfo) error {
	node, ok := ld.net.Get()
	if !ok {
		return fmt.Errorf("p2p node is not yet initialized")
	}
	return node.Connect(ctx, peerInfo)
}

// Connect connects to a remote peer. Necessary here for the grpc server to add a site
// that needs to connect to the site under the hood.
func (ld *lazyDiscoverer) SyncWithPeer(ctx context.Context, deviceID peer.ID) error {
	return fmt.Errorf("TODO(hm24): implement sync with peer")

	// svc, ok := ld.sync.Get()
	// if !ok {
	// 	return fmt.Errorf("sync not ready yet")
	// }

	// return svc.SyncWithPeer(ctx, deviceID)
}
