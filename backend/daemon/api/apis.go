package api

import (
	"context"
	"seed/backend/core"
	activity "seed/backend/daemon/api/activity/v1alpha"
	daemon "seed/backend/daemon/api/daemon/v1alpha"
	documentsv3 "seed/backend/daemon/api/documents/v3alpha"
	entities "seed/backend/daemon/api/entities/v1alpha"
	networking "seed/backend/daemon/api/networking/v1alpha"
	"seed/backend/daemon/index"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/syncing"

	"crawshaw.io/sqlite/sqlitex"
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
		Daemon:      daemon.NewServer(repo, wallet, doSync),
		Networking:  networking.NewServer(node, db),
		Entities:    entities.NewServer(idx, nil), // TOOD(hm24): provide a discoverer.
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
