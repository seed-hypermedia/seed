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
	"seed/backend/devicelink"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet"
	"seed/backend/hmnet/syncing"
	"seed/backend/logging"
	"seed/backend/storage"

	"github.com/libp2p/go-libp2p/core/peer"
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

// New creates a new API server.
func New(
	repo *storage.Store,
	idx *blob.Index,
	node *hmnet.Node,
	sync *syncing.Service,
	activity *activity.Server,
	LogLevel string,
	isMainnet bool,
	dlink *devicelink.Service,
) Server {
	db := repo.DB()
	proxy := &p2pProxy{node: node}
	return Server{
		Activity:    activity,
		Daemon:      daemon.NewServer(repo, &p2pNodeSubset{node: node, sync: sync}, idx, dlink),
		Networking:  networking.NewServer(node, db, logging.New("seed/networking", LogLevel)),
		Entities:    entities.NewServer(db, sync),
		DocumentsV3: documentsv3.NewServer(repo.KeyStore(), idx, db, logging.New("seed/documents", LogLevel), node),
		Syncing:     sync,
		Payments:    payments.NewServer(logging.New("seed/payments", LogLevel), db, node, repo.KeyStore(), isMainnet),
		P2PProxy:    proxy,
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

func (p *p2pNodeSubset) SyncResourcesWithPeer(ctx context.Context, pid peer.ID, resources []string, prog *syncing.DiscoveryProgress) error {
	return p.sync.SyncResourcesWithPeer(ctx, pid, resources, prog)
}

func (p *p2pNodeSubset) ProtocolID() protocol.ID {
	return p.node.ProtocolID()
}

func (p *p2pNodeSubset) ProtocolVersion() string {
	return p.node.ProtocolVersion()
}

func (p *p2pNodeSubset) AddrInfo() peer.AddrInfo {
	return p.node.AddrInfo()
}
