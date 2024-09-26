// Package mttnet provides Seed P2P network functionality.
package mttnet

import (
	"context"
	"errors"
	"fmt"
	"io"
	"seed/backend/config"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/index"
	"seed/backend/ipfs"
	"seed/backend/util/cleanup"
	"seed/backend/util/libp2px"
	"seed/backend/util/must"
	"sync/atomic"
	"time"

	"seed/backend/util/sqlite/sqlitex"

	provider "github.com/ipfs/boxo/provider"
	"github.com/ipfs/go-datastore"
	dssync "github.com/ipfs/go-datastore/sync"
	manet "github.com/multiformats/go-multiaddr/net"
	"github.com/prometheus/client_golang/prometheus"
	"golang.org/x/sync/errgroup"

	"github.com/libp2p/go-libp2p"
	gostream "github.com/libp2p/go-libp2p-gostream"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/event"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/libp2p/go-libp2p/p2p/host/autorelay"
	"github.com/libp2p/go-libp2p/p2p/host/peerstore/pstoremem"
	"github.com/multiformats/go-multiaddr"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/grpc"
)

const ProtocolSupportKey = "seed-support" // This is what we use as a key to protect the connection in ConnManager.

const (
	protocolPrefix  = "/hypermedia/"
	protocolVersion = "0.4.1"
)

var userAgent = "seed/<dev>"

// DefaultRelays bootstrap seed-owned relays so they can reserve slots to do holepunch.
func DefaultRelays() []peer.AddrInfo {
	return []peer.AddrInfo{
		// HM23 Seed prod server
		{
			ID: must.Do2(peer.Decode("12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq")),
			Addrs: []multiaddr.Multiaddr{
				must.Do2(multiaddr.NewMultiaddr("/ip4/23.20.24.146/tcp/4002")),
				must.Do2(multiaddr.NewMultiaddr("/ip4/23.20.24.146/udp/4002/quic-v1")),
			},
		},
		// HM23 Seed test server
		{
			ID: must.Do2(peer.Decode("12D3KooWGvsbBfcbnkecNoRBM7eUTiuriDqUyzu87pobZXSdUUsJ")),
			Addrs: []multiaddr.Multiaddr{
				must.Do2(multiaddr.NewMultiaddr("/ip4/52.22.139.174/tcp/4002")),
				must.Do2(multiaddr.NewMultiaddr("/ip4/52.22.139.174/udp/4002/quic-v1")),
			},
		},

		// HM24 Seed test server
		{
			ID: must.Do2(peer.Decode("12D3KooWMGVVkxCsGAKHBPNLSBEoyzzVMtmSkGFP6dmdJ5H9jV9d")),
			Addrs: []multiaddr.Multiaddr{
				must.Do2(multiaddr.NewMultiaddr("/dns4/test.hyper.media/tcp/4002")),
				must.Do2(multiaddr.NewMultiaddr("/dns4/test.hyper.media/udp/4002/quic-v1")),
			},
		},
	}
}

// Server holds the p2p functionality to be accessed via gRPC.
type rpcMux struct {
	Node *Node
}

// Node is a Seed P2P node.
type Node struct {
	log                    *zap.Logger
	index                  *index.Index
	db                     *sqlitex.Pool
	device                 core.KeyPair
	keys                   core.KeyStore
	cfg                    config.P2P
	invoicer               Invoicer
	client                 *Client
	connectionCallback     func(context.Context, event.EvtPeerConnectednessChanged)
	identificationCallback func(context.Context, event.EvtPeerIdentificationCompleted)
	protocol               protocolInfo
	p2p                    *ipfs.Libp2p
	bitswap                *ipfs.Bitswap
	providing              provider.System
	grpc                   *grpc.Server
	clean                  cleanup.Stack
	ready                  chan struct{}
	currentReachability    atomic.Value    // type of network.Reachability
	ctx                    context.Context // will be set after calling Start()
}

// New creates a new P2P Node. The users must call Start() before using the node, and can use Ready() to wait
// for when the node is ready to use.
func New(cfg config.P2P, device core.KeyPair, ks core.KeyStore, db *sqlitex.Pool, index *index.Index, log *zap.Logger) (n *Node, err error) {
	var clean cleanup.Stack
	defer func() {
		// Make sure to close everything if we fail in the middle of the initialization.
		if err != nil {
			err = errors.Join(err, clean.Close())
		}
	}()

	var testnetSuffix string
	if cfg.TestnetName != "" {
		testnetSuffix = "-" + cfg.TestnetName
	}

	protoInfo := newProtocolInfo(protocolPrefix, protocolVersion+testnetSuffix)

	host, closeHost, err := newLibp2p(cfg, device.Wrapped(), protoInfo.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to start libp2p host: %w", err)
	}
	clean.Add(closeHost)

	bitswap, err := ipfs.NewBitswap(host, host.Routing, index.IPFSBlockstore())
	if err != nil {
		return nil, fmt.Errorf("failed to start bitswap: %w", err)
	}
	clean.Add(bitswap)

	// TODO(burdiyan): find a better reproviding strategy than naive provide-everything.

	logLevel := ""
	if log.Level() != zapcore.InvalidLevel { // Usually test with zap.NewNop()
		logLevel = log.Level().String()
	}
	providing, err := ipfs.NewProviderSystem(host.Datastore(), host.Routing, makeProvidingStrategy(db, logLevel))
	if err != nil {
		return nil, fmt.Errorf("failed to initialize providing: %w", err)
	}
	clean.Add(providing)

	client := newClient(device.PeerID(), host, protoInfo.ID)
	clean.Add(client)

	n = &Node{
		log:       log,
		index:     index,
		db:        db,
		device:    device,
		keys:      ks,
		cfg:       cfg,
		client:    client,
		protocol:  protoInfo,
		p2p:       host,
		bitswap:   bitswap,
		providing: providing,
		grpc:      grpc.NewServer(),
		clean:     clean,
		ready:     make(chan struct{}),
	}
	n.connectionCallback = n.defaultConnectionCallback
	n.identificationCallback = n.defaultIdentificationCallback
	n.currentReachability.Store(network.ReachabilityUnknown)
	sub, err := host.EventBus().Subscribe([]interface{}{
		new(event.EvtPeerIdentificationCompleted),
		new(event.EvtPeerConnectednessChanged),
		new(event.EvtLocalReachabilityChanged),
	})
	if err != nil {
		return nil, err
	}
	clean.Add(sub)

	go func() {
		for e := range sub.Out() {
			switch event := e.(type) {
			case event.EvtPeerConnectednessChanged:
				if n.connectionCallback != nil {
					n.connectionCallback(n.ctx, event)
				}
			case event.EvtPeerIdentificationCompleted:
				if n.identificationCallback != nil {
					n.identificationCallback(n.ctx, event)
				}
			case event.EvtLocalReachabilityChanged:
				n.currentReachability.Store(event.Reachability)
			}
		}
	}()

	rpc := &rpcMux{Node: n}
	p2p.RegisterP2PServer(n.grpc, rpc)
	p2p.RegisterSyncingServer(n.grpc, rpc)
	return n, nil
}

// SetInvoicer assign an invoicer service to the node struct.
func (n *Node) SetInvoicer(inv Invoicer) {
	n.invoicer = inv
}

// ProtocolID returns the supported protocol ID.
func (n *Node) ProtocolID() protocol.ID {
	return n.protocol.ID
}

// GetProtocolInfo returns the supported protocol version.
func (n *Node) ProtocolVersion() string {
	return n.protocol.version
}

// RegisterRPCService allows registering additional gRPC services to be exposed over libp2p.
// This function must be called before calling Start().
func (n *Node) RegisterRPCService(fn func(grpc.ServiceRegistrar)) {
	fn(n.grpc)
}

// SetConnectionCallback allows registering a callback to be called any peer of ours changes its
// connectivity status. This is called when a known peer goes offline of when we get a new peer.
func (n *Node) SetConnectionCallback(fn func(context.Context, event.EvtPeerConnectednessChanged)) {
	n.connectionCallback = fn
}

// SetIdentificationCallback allows registering a callback to be called when initial identification
// round for a peer is completed.
func (n *Node) SetIdentificationCallback(fn func(context.Context, event.EvtPeerIdentificationCompleted)) {
	n.identificationCallback = fn
}

// Bitswap returns the underlying Bitswap service.
func (n *Node) Bitswap() *ipfs.Bitswap {
	return n.bitswap
}

// Client dials a remote peer if necessary and returns the RPC client handle.
func (n *Node) Client(ctx context.Context, pid peer.ID) (p2p.P2PClient, error) {
	if err := n.Connect(ctx, n.p2p.Peerstore().PeerInfo(pid)); err != nil {
		return nil, err
	}

	return n.client.Dial(ctx, pid)
}

// SyncingClient opens a connection with a remote node for syncing using RBSR algorithm.
func (n *Node) SyncingClient(ctx context.Context, pid peer.ID) (p2p.SyncingClient, error) {
	if err := n.Connect(ctx, n.p2p.Peerstore().PeerInfo(pid)); err != nil {
		return nil, err
	}

	conn, err := n.client.dialPeer(ctx, pid)
	if err != nil {
		return nil, err
	}
	return p2p.NewSyncingClient(conn), nil
}

// ArePrivateIPsAllowed check if private IPs (local) are allowed to connect.
func (n *Node) ArePrivateIPsAllowed() bool {
	return !n.cfg.NoPrivateIps
}

// AccountForDevice returns the linked AccountID of a given device.
func (n *Node) AccountForDevice(ctx context.Context, pid peer.ID) (core.Principal, error) {
	// TODO(hm24): How to know the public key of other peers?
	if n.p2p.Network().LocalPeer() == pid {
		pk, err := n.keys.GetKey(ctx, "main")
		if err != nil {
			return nil, fmt.Errorf("Can't get account for this device. Has the user registered any key?")
		}
		return pk.PublicKey.Principal(), nil
	}
	return nil, fmt.Errorf("Can't know the account of a peer different than myself.")
	/*
		var out core.Principal
		if err := n.blobs.Query(ctx, func(conn *sqlite.Conn) error {
			pk, err := pid.ExtractPublicKey()
			if err != nil {
				return err
			}

			delegate := core.PrincipalFromPubKey(pk)

			list, err := hypersql.KeyDelegationsListByDelegate(conn, delegate)
			if err != nil {
				return err
			}
			if len(list) == 0 {
				return fmt.Errorf("not found key delegation for peer: %s", pid)
			}

			if len(list) > 1 {
				n.log.Warn("MoreThanOneKeyDelegation", zap.String("peer", pid.String()))
			}

			del := list[0]

			out = core.Principal(del.KeyDelegationsViewIssuer)

			return nil
		}); err != nil {
			return nil, err
		}

		return out, nil
	*/
}

// Libp2p returns the underlying libp2p host.
func (n *Node) Libp2p() *ipfs.Libp2p { return n.p2p }

// Start the node. It will block while node is running. To stop gracefully
// cancel the provided context and wait for Start to return.
func (n *Node) Start(ctx context.Context) (err error) {
	n.ctx = ctx

	n.log.Info("P2PNodeStarted", zap.String("protocolID", string(n.protocol.ID)))

	defer func() { n.log.Info("P2PNodeFinished", zap.Error(err)) }()

	if err := n.startLibp2p(ctx); err != nil {
		return err
	}
	if err := n.p2p.Peerstore().AddProtocols(n.client.host.ID(), n.protocol.ID); err != nil {
		return fmt.Errorf("failed to add seed protocol: %w", err)
	}
	lis, err := gostream.Listen(n.p2p.Host, n.protocol.ID)
	if err != nil {
		return fmt.Errorf("failed to start listener: %w", err)
	}

	g, ctx := errgroup.WithContext(ctx)

	// Start Hyper Media protocol listener over libp2p.
	{
		g.Go(func() error {
			return n.grpc.Serve(lis)
		})

		g.Go(func() error {
			<-ctx.Done()
			n.grpc.GracefulStop()
			return nil
		})
	}

	// Indicate that node is ready to work with.
	close(n.ready)
	n.clean.AddErrFunc(func() error { return g.Wait() })

	// When context is canceled the whole errgroup will be tearing down.
	// We have to wait until all goroutines finish, and then call the cleanup stack.
	return n.clean.Close()
}

// AddrInfo returns info for our own peer.
func (n *Node) AddrInfo() peer.AddrInfo {
	return n.p2p.AddrInfo()
}

// Ready channel is closed when the node is ready to use. It can be used
// to await for the node to be bootstrapped and ready.
func (n *Node) Ready() <-chan struct{} {
	return n.ready
}

func (n *Node) startLibp2p(ctx context.Context) error {
	var addrs []multiaddr.Multiaddr
	if n.cfg.ListenAddrs != nil {
		addrs = append(addrs, n.cfg.ListenAddrs...)
	} else {
		lis := libp2px.DefaultListenAddrs(n.cfg.Port)
		for _, l := range lis {
			addr, err := multiaddr.NewMultiaddr(l)
			if err != nil {
				return err
			}
			addrs = append(addrs, addr)
		}
	}

	if err := n.p2p.Listen(addrs); err != nil {
		return err
	}

	doneOnce := make(chan struct{})
	if !n.cfg.NoBootstrap() {
		done := make(chan struct{})
		go func() {
			peersfn := func() []peer.AddrInfo { return n.cfg.BootstrapPeers }
			var count int
			ipfs.PeriodicBootstrap(ctx, n.p2p.Host, n.p2p.Routing, peersfn, func(_ context.Context, result ipfs.BootstrapResult) {
				fields := []zap.Field{
					zap.Int("round", count+1),
					zap.NamedError("dhtError", result.RoutingErr),
					zap.Int("dialedPeers", len(result.Peers)),
					zap.Int("failures", int(result.NumFailedConnections)),
				}
				if result.NumFailedConnections > 0 {
					fields = append(fields, zap.Errors("errors", result.ConnectErrs))
				}

				n.log.Info("BootstrapFinished", fields...)
				if count == 0 {
					close(doneOnce)
				}
				count++
			})
			close(done)
		}()
		// We wait for the periodic bootstrap to shutdown cleanly.
		n.clean.AddErrFunc(func() error {
			<-done
			return nil
		})
	} else {
		n.log.Warn("NoBoostrapMode")
		close(doneOnce)
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-doneOnce:
		return nil
	}
}

// AddrInfoToStrings returns address as string.
func AddrInfoToStrings(info peer.AddrInfo) []string {
	var addrs []string
	for _, a := range info.Addrs {
		addrs = append(addrs, a.Encapsulate(must.Do2(multiaddr.NewComponent("p2p", info.ID.String()))).String())
	}

	return addrs
}

// AddrInfoFromStrings converts a list of full multiaddrs belonging to the same peer ID into a AddrInfo structure.
func AddrInfoFromStrings(addrs ...string) (out peer.AddrInfo, err error) {
	for i, a := range addrs {
		ma, err := multiaddr.NewMultiaddr(a)
		if err != nil {
			return out, fmt.Errorf("failed to parse multiaddr %s: %w", a, err)
		}

		transport, id := peer.SplitAddr(ma)
		if id == "" {
			return peer.AddrInfo{}, peer.ErrInvalidAddr
		}

		if i == 0 {
			out.ID = id
		} else {
			if out.ID != id {
				return out, fmt.Errorf("peer IDs do not match: %s != %s", out.ID, id)
			}
		}

		if transport != nil {
			out.Addrs = append(out.Addrs, transport)
		}
	}

	return out, nil
}

func newLibp2p(cfg config.P2P, device crypto.PrivKey, protocolID protocol.ID) (*ipfs.Libp2p, io.Closer, error) {
	var clean cleanup.Stack

	ps, err := pstoremem.NewPeerstore()
	if err != nil {
		return nil, nil, err
	}
	// Not adding peerstore to the cleanup stack because weirdly enough, libp2p host closes it,
	// even if it doesn't own it. See BasicHost#Close() inside libp2p.

	ds := dssync.MutexWrap(datastore.NewMapDatastore())
	clean.Add(ds)

	opts := []libp2p.Option{
		libp2p.UserAgent(userAgent),
		libp2p.Peerstore(ps),
		libp2p.EnableHolePunching(),
	}

	if cfg.AnnounceAddrs != nil {
		opts = append(opts,
			libp2p.AddrsFactory(func([]multiaddr.Multiaddr) []multiaddr.Multiaddr {
				return cfg.AnnounceAddrs
			}),
		)
	} else {
		opts = append(opts,
			libp2p.AddrsFactory(func(addrs []multiaddr.Multiaddr) []multiaddr.Multiaddr {
				announce := make([]multiaddr.Multiaddr, 0, len(addrs))
				if cfg.NoPrivateIps {
					for _, a := range addrs {
						if manet.IsPublicAddr(a) {
							announce = append(announce, a)
						}
					}
					return announce
				}
				return addrs
			}),
		)
	}

	// We force private reachability unless we force public one and we don't need relay.
	if !cfg.ForceReachabilityPublic && !cfg.NoRelay {
		opts = append(opts, libp2p.ForceReachabilityPrivate())
	} else {
		opts = append(opts, libp2p.EnableNATService())
	}

	if !cfg.NoRelay {
		opts = append(opts,
			libp2p.EnableAutoRelayWithStaticRelays(DefaultRelays(),
				autorelay.WithBootDelay(time.Second*5),
				autorelay.WithNumRelays(2),
				autorelay.WithMinCandidates(2),
				autorelay.WithBackoff(cfg.RelayBackoff),
			),
		)
	}

	m := ipfs.NewLibp2pMetrics()

	if !cfg.NoMetrics {
		opts = append(opts, libp2p.BandwidthReporter(m))
	}

	node, err := ipfs.NewLibp2pNode(device, ds, protocolID, opts...)
	if err != nil {
		return nil, nil, err
	}
	clean.Add(node)

	m.SetHost(node.Host)

	if !cfg.NoMetrics {
		prometheus.MustRegister(m)
	}

	return node, &clean, nil
}

type protocolInfo struct {
	ID      protocol.ID
	prefix  string
	version string
}

func newProtocolInfo(prefix, version string) protocolInfo {
	return protocolInfo{
		ID:      protocol.ID(prefix + version),
		prefix:  prefix,
		version: version,
	}
}
