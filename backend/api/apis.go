package api

import (
	"context"
	activity "seed/backend/api/activity/v1alpha"
	daemon "seed/backend/api/daemon/v1alpha"
	documentsv3 "seed/backend/api/documents/v3alpha"
	entities "seed/backend/api/entities/v1alpha"
	networking "seed/backend/api/networking/v1alpha"
	payments "seed/backend/api/payments/v1alpha"
	"seed/backend/blob"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/logging"
	"seed/backend/hmnet"
	"seed/backend/syncing"

	"seed/backend/util/sqlite/sqlitex"

	"github.com/libp2p/go-libp2p/core/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

// Server combines all the daemon API services into one thing.
type Server struct {
	Daemon      *daemon.Server
	Networking  *networking.Server
	Entities    *entities.Server
	Activity    *activity.Server
	Syncing     *syncing.Service
	DocumentsV3 *documentsv3.Server
	Payments    *payments.Server
	P2PProxy    interface {
		p2p.P2PServer
		p2p.SyncingServer
		RegisterServer(src grpc.ServiceRegistrar)
	}
}

// Storage holds all the storing functionality.
type Storage interface {
	DB() *sqlitex.Pool
	KeyStore() core.KeyStore
	Migrate() error
	Device() core.KeyPair
}

// New creates a new API server.
func New(
	repo Storage,
	idx *blob.Index,
	node *hmnet.Node,
	sync *syncing.Service,
	activity *activity.Server,
	LogLevel string,
	isMainnet bool,
) Server {
	db := repo.DB()

	return Server{
		Activity:    activity,
		Daemon:      daemon.NewServer(repo, &p2pNodeSubset{node: node, sync: sync}),
		Networking:  networking.NewServer(node, db, logging.New("seed/networking", LogLevel)),
		Entities:    entities.NewServer(idx, sync),
		DocumentsV3: documentsv3.NewServer(repo.KeyStore(), idx, db, logging.New("seed/documents", LogLevel)),
		Syncing:     sync,
		Payments:    payments.NewServer(logging.New("seed/payments", LogLevel), db, node, repo.KeyStore(), isMainnet),
		P2PProxy:    &p2pProxy{node: node},
	}
}

// Register API services on the given gRPC server.
func (s Server) Register(srv *grpc.Server) {
	s.Daemon.RegisterServer(srv)
	s.Activity.RegisterServer(srv)
	s.Networking.RegisterServer(srv)
	s.Entities.RegisterServer(srv)
	s.DocumentsV3.RegisterServer(srv)
	s.Payments.RegisterServer(srv)
	s.P2PProxy.RegisterServer(srv)

	reflection.Register(srv)
}

type p2pNodeSubset struct {
	node *hmnet.Node
	sync *syncing.Service
}

func (p *p2pNodeSubset) ForceSync() error {
	go func() {
		if err := p.sync.SyncAllAndLog(context.Background()); err != nil {
			panic("bug or fatal error during sync " + err.Error())
		}
	}()

	return nil
}

func (p *p2pNodeSubset) ProtocolID() protocol.ID {
	return p.node.ProtocolID()
}

func (p *p2pNodeSubset) ProtocolVersion() string {
	return p.node.ProtocolVersion()
}
