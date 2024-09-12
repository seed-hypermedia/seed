package api

import (
	"context"
	activity "seed/backend/api/activity/v1alpha"
	daemon "seed/backend/api/daemon/v1alpha"
	documentsv3 "seed/backend/api/documents/v3alpha"
	entities "seed/backend/api/entities/v1alpha"
	networking "seed/backend/api/networking/v1alpha"
	"seed/backend/core"
	"seed/backend/index"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/syncing"

	"seed/backend/util/sqlite/sqlitex"

	"github.com/libp2p/go-libp2p/core/protocol"
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
	idx *index.Index,
	node *mttnet.Node,
	wallet daemon.Wallet,
	sync *syncing.Service,
	activity *activity.Server,
	LogLevel string,
) Server {
	db := repo.DB()

	return Server{
		Activity:    activity,
		Daemon:      daemon.NewServer(repo, wallet, &p2pNodeSubset{node: node, sync: sync}),
		Networking:  networking.NewServer(node, db, logging.New("seed/networking", LogLevel)),
		Entities:    entities.NewServer(idx, sync),
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

type p2pNodeSubset struct {
	node *mttnet.Node
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
