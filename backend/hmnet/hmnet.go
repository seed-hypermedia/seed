// Package hmnet provides Seed P2P network functionality.
package hmnet

import (
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"runtime"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing"
	"seed/backend/ipfs"
	"seed/backend/util/bwcounter"
	"seed/backend/util/cleanup"
	"seed/backend/util/grpcprom"
	"seed/backend/util/libp2px"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ipfs/boxo/bitswap"
	"github.com/ipfs/go-datastore"
	dssync "github.com/ipfs/go-datastore/sync"
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
	manet "github.com/multiformats/go-multiaddr/net"
	"github.com/prometheus/client_golang/prometheus"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
)

var (
	rpcServerMetrics = grpcprom.NewServerMetrics("seed", "p2p")
	rpcClientMetrics = grpcprom.NewClientMetrics("seed", "p2p")
)

// ProtocolSupportKey is what we use as a key to protect the connection in ConnManager.
const ProtocolSupportKey = "seed-support"

const (
	// ProtocolPrefix is the prefix for the seed protocol ID.
	ProtocolPrefix  = "/hypermedia/"
	protocolVersion = "0.9.2"
)

var userAgent = "seed/<dev>"

// bitswapWorkerCount caps the boxo bitswap server's blockstore worker pool.
// boxo defaults to 128 (BitswapEngineBlockstoreWorkerCount in
// boxo/bitswap/internal/defaults/defaults.go), tuned for big public IPFS
// gateways. With our SQLite pool size, 128 workers serialize on
// sqlitex.Pool.Get and produce hundreds of thousands of mutex contention
// events per minute. Scale with cores instead, with a small floor so a
// single-core VPS still has enough parallelism to overlap I/O.
func bitswapWorkerCount() int {
	n := runtime.NumCPU() * 4
	if n < 16 {
		n = 16
	}
	return n
}

// DefaultRelays bootstrap seed-owned relays so they can reserve slots to do holepunch.
func DefaultRelays() []peer.AddrInfo {
	return []peer.AddrInfo{
		// HM25 Seed prod server
		{
			ID: must.Do2(peer.Decode("12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq")),
			Addrs: []multiaddr.Multiaddr{
				must.Do2(multiaddr.NewMultiaddr("/ip4/40.160.6.196/tcp/4002")),
				must.Do2(multiaddr.NewMultiaddr("/ip4/40.160.6.196/udp/4002/quic-v1")),
			},
		},
		// HM25 Seed test server
		{
			ID: must.Do2(peer.Decode("12D3KooWGvsbBfcbnkecNoRBM7eUTiuriDqUyzu87pobZXSdUUsJ")),
			Addrs: []multiaddr.Multiaddr{
				must.Do2(multiaddr.NewMultiaddr("/ip4/15.204.217.165/tcp/4002")),
				must.Do2(multiaddr.NewMultiaddr("/ip4/15.204.217.165/udp/4002/quic-v1")),
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
	log                 *zap.Logger
	index               *blob.Index
	db                  *sqlitex.Pool
	device              *core.KeyPair
	keys                core.KeyStore
	cfg                 config.P2P
	invoicer            Invoicer
	client              *Client
	protocol            ProtocolInfo
	p2p                 *ipfs.Libp2p
	bitswap             *ipfs.Bitswap
	grpc                *grpc.Server
	clean               cleanup.Stack
	ready               chan struct{}
	libp2pEvents        event.Subscription
	currentReachability atomic.Value    // type of network.Reachability
	ctx                 context.Context // will be set after calling Start()
	startedAt           time.Time       // set when Start() begins, used for uptime reporting

	// metrics owns the libp2p BandwidthReporter + per-peer/per-scope counters
	// surfaced on /debug/network. httpServerBW and httpClientBW count bytes at
	// the HTTP layer (gRPC-Web from the local frontend, file gateway, debug
	// pages; and outbound HTTP we own such as the delegated DHT client).
	metrics      *ipfs.Libp2pMetrics
	httpServerBW *bwcounter.Counter
	httpClientBW *bwcounter.Counter

	// dbSizeAtStart is the SQLite logical size (page_count * page_size) at
	// Node.Start. dbSizeAtStartTime records when the measurement was taken so
	// the page can show growth-over-elapsed. Both are written exactly once
	// from Start() and read freely after that.
	dbSizeAtStart     atomic.Uint64
	dbSizeAtStartTime atomic.Int64 // unix nano

	// peerWriter owns all peer-table writes that originate from libp2p
	// identification events. Its goroutine is started from Start() and
	// stopped via the Start() ctx; see peer_writer.go for design notes.
	peerWriter *peerWriter
}

// New creates a new P2P Node. The users must call Start() before using the node, and can use Ready() to wait
// for when the node is ready to use.
func New(cfg config.P2P, device *core.KeyPair, ks core.KeyStore, db *sqlitex.Pool, index *blob.Index, log *zap.Logger) (n *Node, err error) {
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

	protoInfo := newProtocolInfo(ProtocolPrefix, protocolVersion+testnetSuffix)

	httpServerBW := &bwcounter.Counter{}
	httpClientBW := &bwcounter.Counter{}

	host, libp2pMetrics, closeHost, err := newLibp2p(cfg, device.Libp2pKey(), protoInfo.ID, log, httpClientBW)
	if err != nil {
		return nil, fmt.Errorf("failed to start libp2p host: %w", err)
	}
	clean.Add(closeHost)

	bsOpts := []bitswap.Option{
		bitswap.WithPeerBlockRequestFilter(index.CanPeerAccessCID),
		bitswap.EngineBlockstoreWorkerCount(bitswapWorkerCount()),
	}
	bitswap, err := ipfs.NewBitswap(
		host,
		host.Routing,
		index,
		bsOpts...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to start bitswap: %w", err)
	}
	clean.Add(bitswap)

	// TODO(burdiyan): enable providing and reproviding.

	client := newClient(device.PeerID(), host, protoInfo.ID)
	clean.Add(client)

	n = &Node{
		log:          log,
		index:        index,
		db:           db,
		device:       device,
		keys:         ks,
		cfg:          cfg,
		client:       client,
		protocol:     protoInfo,
		p2p:          host,
		bitswap:      bitswap,
		metrics:      libp2pMetrics,
		httpServerBW: httpServerBW,
		httpClientBW: httpClientBW,
		grpc: grpc.NewServer(
			grpc.StatsHandler(rpcServerMetrics),
			grpc.ChainUnaryInterceptor(
				rpcServerMetrics.UnaryServerInterceptor(),
			),
			grpc.ChainStreamInterceptor(
				rpcServerMetrics.StreamServerInterceptor(),
			),
			// Match the client's extended message size so peer-exchange responses
			// from nodes with thousands of peers don't hit the default 4 MiB cap.
			grpc.MaxRecvMsgSize(maxP2PMessageSize),
			grpc.MaxSendMsgSize(maxP2PMessageSize),
		),
		clean: clean,
		ready: make(chan struct{}),
	}
	n.peerWriter = newPeerWriter(db, log)
	n.currentReachability.Store(network.ReachabilityUnknown)
	n.libp2pEvents, err = host.EventBus().Subscribe([]interface{}{
		new(event.EvtPeerIdentificationCompleted),
		new(event.EvtPeerConnectednessChanged),
		new(event.EvtLocalReachabilityChanged),
	})
	if err != nil {
		return nil, err
	}
	clean.Add(n.libp2pEvents)

	rpc := &rpcMux{Node: n}
	syn := syncing.NewServer(n.db, n.index, n.Bitswap(), cfg.MaxInboundReconciles, cfg.InboundReconcileWait)
	syn.RegisterServer(n.grpc)
	p2p.RegisterP2PServer(n.grpc, rpc)
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
	return n.protocol.Version
}

// RegisterRPCService allows registering additional gRPC services to be exposed over libp2p.
// This function must be called before calling Start().
func (n *Node) RegisterRPCService(fn func(grpc.ServiceRegistrar)) {
	fn(n.grpc)
}

// Bitswap returns the underlying Bitswap service.
func (n *Node) Bitswap() *ipfs.Bitswap {
	return n.bitswap
}

// Client dials a remote peer if necessary and returns the RPC client handle.
func (n *Node) Client(ctx context.Context, pid peer.ID, addrs ...multiaddr.Multiaddr) (p2p.P2PClient, error) {
	n.p2p.Peerstore().AddAddrs(pid, addrs, 5*time.Minute)
	if err := n.Connect(ctx, n.p2p.Peerstore().PeerInfo(pid)); err != nil {
		return nil, err
	}

	return n.client.Dial(ctx, pid)
}

// SyncingClient opens a connection with a remote node for syncing.
func (n *Node) SyncingClient(ctx context.Context, pid peer.ID, addrs ...multiaddr.Multiaddr) (p2p.SyncingClient, error) {
	n.p2p.Peerstore().AddAddrs(pid, addrs, 5*time.Minute)
	addrinfo := n.p2p.Peerstore().PeerInfo(pid)

	if err := n.Connect(ctx, addrinfo); err != nil {
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

// GetAccountByKeyName returns the account attached to the given named key.
func (n *Node) GetAccountByKeyName(ctx context.Context, keyName string) (core.Principal, error) {
	pk, err := n.keys.GetKey(ctx, keyName)
	if err != nil {
		return nil, fmt.Errorf("Can't get account for this device: %w", err)
	}
	return pk.PublicKey.Principal(), nil
}

// Libp2p returns the underlying libp2p host.
func (n *Node) Libp2p() *ipfs.Libp2p { return n.p2p }

// Metrics returns the libp2p metrics object, exposing per-peer/per-scope
// bandwidth book-keeping for the /debug/network page.
func (n *Node) Metrics() *ipfs.Libp2pMetrics { return n.metrics }

// HTTPServerBW returns the inbound HTTP bandwidth counter (gRPC-Web from the
// local frontend, file gateway, debug pages).
func (n *Node) HTTPServerBW() *bwcounter.Counter { return n.httpServerBW }

// HTTPClientBW returns the outbound HTTP bandwidth counter (delegated DHT and
// any other outbound HTTP we own).
func (n *Node) HTTPClientBW() *bwcounter.Counter { return n.httpClientBW }

// DBSizeAtStart returns the SQLite logical size sampled at Node.Start, in
// bytes. Returns (0, zero) before Start() runs.
func (n *Node) DBSizeAtStart() (size uint64, when time.Time) {
	size = n.dbSizeAtStart.Load()
	if ns := n.dbSizeAtStartTime.Load(); ns != 0 {
		when = time.Unix(0, ns)
	}
	return size, when
}

// DBSizeNow runs PRAGMA page_count * page_size on a fresh connection and
// returns the current logical SQLite size in bytes. Cheap (header read only).
func (n *Node) DBSizeNow(ctx context.Context) (uint64, error) {
	return dbLogicalSize(ctx, n.db)
}

// IndexDrift reports the number of blobs we have on disk (size >= 0) that are
// NOT indexed in structural_blobs, broken down by codec. RBSR's local set is
// built from structural_blobs only, so any drift here is invisible to the
// diff and gets re-fetched from peers every sync cycle. Surfaced on
// /debug/network to confirm or refute the "we keep downloading what we
// already have" hypothesis.
type IndexDrift struct {
	Total      int64 // blobs in `blobs` but not in `structural_blobs`
	TotalBytes int64 // sum of size (uncompressed) of those blobs
	DagCbor    int64 // subset that should be indexed (Hypermedia structural blobs)
	DagPb      int64 // subset that's IPFS UnixFS (not always expected in structural_blobs)
	Other      int64 // other codecs (e.g. raw)
}

// IndexDrift runs the diagnostic query for blob/structural_blobs drift.
// Single SQL call, joined on indexed primary key, so cost is O(unindexed rows).
func (n *Node) IndexDrift(ctx context.Context) (IndexDrift, error) {
	var d IndexDrift
	conn, release, err := n.db.ReadConn(ctx)
	if err != nil {
		return d, err
	}
	defer release()

	const q = `
		SELECT
			COUNT(*),
			COALESCE(SUM(b.size), 0),
			COALESCE(SUM(CASE WHEN b.codec = 113 THEN 1 ELSE 0 END), 0), -- dag-cbor
			COALESCE(SUM(CASE WHEN b.codec = 112 THEN 1 ELSE 0 END), 0), -- dag-pb
			COALESCE(SUM(CASE WHEN b.codec NOT IN (113, 112) THEN 1 ELSE 0 END), 0)
		FROM blobs b
		LEFT JOIN structural_blobs sb ON sb.id = b.id
		WHERE b.size >= 0 AND sb.id IS NULL`

	if err := sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
		d.Total = stmt.ColumnInt64(0)
		d.TotalBytes = stmt.ColumnInt64(1)
		d.DagCbor = stmt.ColumnInt64(2)
		d.DagPb = stmt.ColumnInt64(3)
		d.Other = stmt.ColumnInt64(4)
		return nil
	}); err != nil {
		return d, err
	}
	return d, nil
}

// dbLogicalSize returns the SQLite logical database size in bytes. This is
// page_count * page_size — what SQLite has allocated on disk for the main
// DB file, excluding WAL frames not yet checkpointed. It's an O(1) header
// read, safe to call on every /debug/network render.
func dbLogicalSize(ctx context.Context, db *sqlitex.Pool) (uint64, error) {
	conn, release, err := db.ReadConn(ctx)
	if err != nil {
		return 0, err
	}
	defer release()

	var pageCount, pageSize int64
	if err := sqlitex.Exec(conn, `PRAGMA page_count`, func(stmt *sqlite.Stmt) error {
		pageCount = stmt.ColumnInt64(0)
		return nil
	}); err != nil {
		return 0, err
	}
	if err := sqlitex.Exec(conn, `PRAGMA page_size`, func(stmt *sqlite.Stmt) error {
		pageSize = stmt.ColumnInt64(0)
		return nil
	}); err != nil {
		return 0, err
	}
	if pageCount < 0 || pageSize < 0 {
		return 0, nil
	}
	return uint64(pageCount) * uint64(pageSize), nil
}

// IsConnCached reports whether we hold a live cached gRPC connection to pid.
// Used by syncing telemetry to label reconcile rounds as cold/warm.
func (n *Node) IsConnCached(pid peer.ID) bool { return n.client.IsConnCached(pid) }

// KeyStore returns the key store used by this node.
func (n *Node) KeyStore() core.KeyStore { return n.keys }

// Start the node. It will block while node is running. To stop gracefully
// cancel the provided context and wait for Start to return.
func (n *Node) Start(ctx context.Context) (err error) {
	n.ctx = ctx
	n.startedAt = time.Now()

	// Snapshot SQLite logical size at startup so /debug/network can show
	// disk growth attributable to this session. Failure here is non-fatal —
	// the page just renders 0 for the baseline.
	if size, sErr := dbLogicalSize(ctx, n.db); sErr == nil {
		n.dbSizeAtStart.Store(size)
		n.dbSizeAtStartTime.Store(time.Now().UnixNano())
	} else {
		n.log.Warn("DBSizeProbeFailed", zap.Error(sErr))
	}

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
		g.Go(func() error {
			t := time.NewTimer(peerExchangeTick)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return nil
				case <-t.C:
				}
				if err := n.runPeerExchangeTick(ctx); err != nil && ctx.Err() == nil {
					n.log.Debug("PeerExchangeTickFailed", zap.Error(err))
				}
				t.Reset(peerExchangeTick)
			}
		})
		// peerWriter drains the identify-driven write queue into
		// batched COMMITs. Exits when ctx is cancelled (Start
		// teardown) so it shares lifetime with the libp2p event loop.
		g.Go(func() error {
			n.peerWriter.run(ctx)
			return nil
		})
		// One-shot peers-table hygiene, run in background so it does
		// NOT gate startup. Two passes: rewrite every row's addresses
		// through the routable + certhash filters, then prune
		// gossip-ingested rows whose updated_at is older than the
		// 30-day freshness window. The cleanup is purely
		// best-effort hygiene — it does not need to complete before
		// the daemon answers RPCs. Holding it inline previously kept
		// the writer mutex for ~4 s on populated tables, blocking
		// every other writer for that whole window. See
		// peerStartupCleanup for the split read-scan / write-tx
		// design that lets it coexist with concurrent peerWriter
		// flushes via CAS guards on the row's `addresses` value.
		const peerPruneFloor = 200
		g.Go(func() error {
			if err := n.peerStartupCleanup(ctx, peerPruneFloor); err != nil && ctx.Err() == nil {
				n.log.Warn("PeerStartupCleanupFailed", zap.Error(err))
			}
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
			ipfs.PeriodicBootstrap(ctx, n.p2p.Host, peersfn, func(_ context.Context, result ipfs.BootstrapResult) {
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

	go n.handleLibp2pEvents()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-doneOnce:
		return nil
	}
}

func (n *Node) handleLibp2pEvents() {
	for e := range n.libp2pEvents.Out() {
		switch event := e.(type) {
		case event.EvtPeerConnectednessChanged:
			n.onLibp2pConnection(n.ctx, event)
		case event.EvtPeerIdentificationCompleted:
			n.onLibp2pIdentification(n.ctx, event)
		case event.EvtLocalReachabilityChanged:
			n.currentReachability.Store(event.Reachability)
		}
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

func newLibp2p(cfg config.P2P, device crypto.PrivKey, protocolID protocol.ID, log *zap.Logger, httpClientBW *bwcounter.Counter) (*ipfs.Libp2p, *ipfs.Libp2pMetrics, io.Closer, error) {
	var clean cleanup.Stack

	ps, err := pstoremem.NewPeerstore()
	if err != nil {
		return nil, nil, nil, err
	}
	// Not adding peerstore to the cleanup stack because weirdly enough, libp2p host closes it,
	// even if it doesn't own it. See BasicHost#Close() inside libp2p.

	ds := dssync.MutexWrap(datastore.NewMapDatastore())
	clean.Add(ds)

	opts := []libp2p.Option{
		libp2p.UserAgent(userAgent),
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
		if cfg.ForceReachabilityPublic {
			opts = append(opts, libp2p.ForceReachabilityPublic())
		}
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

	node, err := ipfs.NewLibp2pNode(device, ds, ps, protocolID, cfg.DelegatedDHTURL, log, httpClientBW, opts...)
	if err != nil {
		return nil, nil, nil, err
	}
	clean.Add(node)

	m.SetHost(node.Host)
	// Register the metrics object as a network.Notifiee so peerScope is kept
	// in sync with connection state. This must run regardless of NoMetrics so
	// the scope classification is always available for the /debug/network page.
	node.Host.Network().Notify(m)

	if !cfg.NoMetrics {
		prometheus.MustRegister(
			m,
			rpcServerMetrics,
			rpcClientMetrics,
		)
	}

	return node, m, &clean, nil
}

// ProtocolInfo is a parsed main Hypermedia protocol ID.
type ProtocolInfo struct {
	ID      protocol.ID
	Prefix  string
	Version string
}

func newProtocolInfo(prefix, version string) ProtocolInfo {
	return ProtocolInfo{
		ID:      protocol.ID(prefix + version),
		Prefix:  prefix,
		Version: version,
	}
}

// ParseProtocolID parses a protocol ID and returns the protocol info.
func ParseProtocolID(s protocol.ID) (ProtocolInfo, error) {
	if !hmProtocolPattern.MatchString(string(s)) {
		return ProtocolInfo{}, fmt.Errorf("invalid protocol ID: %s", s)
	}

	version, ok := strings.CutPrefix(string(s), ProtocolPrefix)
	if !ok {
		return ProtocolInfo{}, fmt.Errorf("BUG: invalid protocol ID: %s", s)
	}

	return newProtocolInfo(ProtocolPrefix, version), nil
}

var hmProtocolPattern = regexp.MustCompile(`^\/hypermedia\/\d\.\d\.\d(-\w+)?$`)

// FindHypermediaProtocol returns the main hypermedia protocol ID from the list of protocols.
func FindHypermediaProtocol(protos []protocol.ID) (pinfo ProtocolInfo, ok bool) {
	for _, p := range protos {
		pinfo, err := ParseProtocolID(p)
		if err == nil {
			return pinfo, true
		}
	}

	return ProtocolInfo{}, false
}
