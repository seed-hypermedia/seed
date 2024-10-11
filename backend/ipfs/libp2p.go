package ipfs

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"seed/backend/util/cleanup"
	"seed/backend/util/must"

	delegated_routing "github.com/ipfs/boxo/routing/http/client"
	content_routing "github.com/ipfs/boxo/routing/http/contentrouter"
	"github.com/ipfs/go-cid"
	"github.com/ipfs/go-datastore"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p-kad-dht/providers"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	routing "github.com/libp2p/go-libp2p/core/routing"
	rcmgr "github.com/libp2p/go-libp2p/p2p/host/resource-manager"
	"github.com/libp2p/go-libp2p/p2p/net/connmgr"
	"github.com/multiformats/go-multiaddr"
	manet "github.com/multiformats/go-multiaddr/net"
	"go.uber.org/zap"
)

const (
	highWatermark = 100
	lowWatermark  = 50
)

// Libp2p exposes libp2p host and the underlying routing system (DHT).
// It provides some reasonable defaults, and also handles shutdown more gracefully.
type Libp2p struct {
	host.Host

	ds      datastore.Batching
	Routing router

	clean cleanup.Stack
}
type router interface {
	Provide(context.Context, cid.Cid, bool) error
	FindPeer(context.Context, peer.ID) (peer.AddrInfo, error)
	FindProvidersAsync(context.Context, cid.Cid, int) (ch <-chan peer.AddrInfo)
}

// NewLibp2pNode creates a new node. It's a convenience wrapper around the main libp2p package.
// It forces one to pass the peer private key and datastore.
// To the default options of the libp2p package it also adds DHT Routing, Connection Manager, Relay protocol support.
// To actually enable relay you also need to pass EnableAutoRelay, and optionally enable HolePunching.
// The returning node won't be listening on the network by default, so users have to start listening manually,
// using the Listen() method on the underlying P2P network.
func NewLibp2pNode(key crypto.PrivKey, ds datastore.Batching, protocolID protocol.ID, delegatedDHTURL string, log *zap.Logger, opts ...libp2p.Option) (nn *Libp2p, err error) {
	var clean cleanup.Stack

	defer func() {
		if err != nil {
			err = errors.Join(err, clean.Close())
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	clean.AddFunc(cancel)
	rm, err := buildResourceManager(
		map[protocol.ID]rcmgr.LimitVal{
			protocolID: 1000,
		},
		map[protocol.ID]rcmgr.LimitVal{
			"/ipfs/kad/1.0.0":     1000,
			"/ipfs/bitswap/1.2.0": 1000,
		},
	)
	if err != nil {
		return nil, err
	}
	var rt router
	cm := must.Do2(connmgr.NewConnManager(lowWatermark, highWatermark,
		connmgr.WithGracePeriod(5*time.Second),
		connmgr.WithSilencePeriod(6*time.Second)))

	pid, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		return nil, err
	}
	/*
		ma, err := multiaddr.NewMultiaddr("/ip4/23.20.24.146/udp/4002/quic-v1/webtransport/certhash/uEiD05vslvQT_ZncqgCfYljWOMicJVFlPhIKEuktYH51ENA/certhash/uEiASOpf9RXh2HmEVZlfajKs6yWofMvS-vJbnR9KNwmdn3Q/p2p/12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq/p2p-circuit/p2p/12D3KooWD863Q7NNMeLWnyujrgq29nsB6QrRSVTTYV7F8FowiVN4")
		if err != nil {
			return nil, fmt.Errorf("failed to parse multiaddr")
		}
	*/
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 500
	transport.MaxIdleConnsPerHost = 100

	delegateHTTPClient := &http.Client{
		Transport: &delegated_routing.ResponseBodyLimitedTransport{
			RoundTripper: transport,
			LimitBytes:   1 << 20,
		},
	}
	o := []libp2p.Option{
		libp2p.Identity(key),
		libp2p.NoListenAddrs, // Users must explicitly start listening.
		libp2p.EnableRelay(), // Be able to dial behind-relay peers and receive connections from them.
		libp2p.EnableAutoNATv2(),
		libp2p.ConnectionManager(cm),
		libp2p.ResourceManager(rm),
		libp2p.Routing(func(h host.Host) (routing.PeerRouting, error) {
			if delegatedDHTURL != "" {
				client, err := delegated_routing.New(delegatedDHTURL,
					delegated_routing.WithHTTPClient(delegateHTTPClient),
					delegated_routing.WithIdentity(key),
					delegated_routing.WithUserAgent("seed-hypermedia"),
					delegated_routing.WithProviderInfo(pid, nil),
					delegated_routing.WithDisabledLocalFiltering(false),
				)
				if err != nil {
					return nil, err
				}
				rt = content_routing.NewContentRoutingClient(client)
				log.Info("Delegated DHT Mode", zap.String("Server URL", delegatedDHTURL))
			} else {
				if ds == nil {
					panic("BUG: must provide datastore for DHT")
				}

				// The DHT code creates this automatically to store providing records,
				// but the problem is that it doesn't close it properly. When this provider
				// manager wants to flush records into the database, we would have closed the database
				// already. Because of this we always have an annoying error during our shutdown.
				// Here we manually ensure all the goroutines started by provider manager are closed.
				provStore, err := providers.NewProviderManager(h.ID(), h.Peerstore(), ds)
				if err != nil {
					return nil, err
				}
				clean.Add(provStore)
				fullDHT, err := dht.New(ctx, h,
					dht.Concurrency(1),
					// Forcing DHT client mode.
					// This libp2p node is not meant to be a DHT server.
					dht.Mode(dht.ModeClient),
					dht.ProviderStore(provStore),
					dht.Datastore(ds),

					// Options copied from dualdht package.
					dht.QueryFilter(dht.PublicQueryFilter),
					dht.RoutingTableFilter(dht.PublicRoutingTableFilter),
					// Not sure what those magic numbers are. Copied from dualdht package.
					// We don't use it because we don't need the LAN DHT.
					dht.RoutingTablePeerDiversityFilter(dht.NewRTPeerDiversityFilter(h, 1, 1)),
					// Filter out all private addresses
					dht.AddressFilter(func(addrs []multiaddr.Multiaddr) []multiaddr.Multiaddr {
						return multiaddr.FilterAddrs(addrs, manet.IsPublicAddr)
					}),
				)
				if err != nil {
					return nil, err
				}
				if fullDHT.Bootstrap(ctx) != nil {
					return nil, err
				}
				log.Info("Local DHT Mode")
				rt = fullDHT
			}

			return rt, nil
		}),
	}

	o = append(o, opts...)

	node, err := libp2p.New(o...)
	if err != nil {
		return nil, err
	}
	clean.Add(node)

	return &Libp2p{
		ds:      ds,
		clean:   clean,
		Host:    node,
		Routing: rt,
	}, nil
}

// Listen starts listening on the network.
func (n *Libp2p) Listen(addrs []multiaddr.Multiaddr) error {
	return n.Host.Network().Listen(addrs...)
}

// AddrsFull returns a list of fully-qualified multiaddrs.
func (n *Libp2p) AddrsFull() []multiaddr.Multiaddr {
	info := n.AddrInfo()
	addrs, err := peer.AddrInfoToP2pAddrs(&info)
	if err != nil {
		panic(err)
	}

	return addrs
}

// AddrInfo returns the addresses of the running node.
func (n *Libp2p) AddrInfo() peer.AddrInfo {
	return peer.AddrInfo{
		ID:    n.Host.ID(),
		Addrs: n.Host.Addrs(),
	}
}

// GetConnLimit returns the connection manager limit.
func (n *Libp2p) GetConnLimit() int {
	return highWatermark
}

// Datastore returns the underlying datastore for convenience.
func (n *Libp2p) Datastore() datastore.Batching {
	return n.ds
}

// Close the node and all the underlying systems.
func (n *Libp2p) Close() error {
	return n.clean.Close()
}

// buildResourceManager returns a resource manager given two sets of hard limits. for each protocol listed in ourProtocols (seed protocols)
// we apply the maximum limits of ourStreamsHardLimit. For their protocols (non seed protocols) we apply the maximum limits of theirStreamsHardLimit
func buildResourceManager(ourProtocolLimits map[protocol.ID]rcmgr.LimitVal, theirProtocolLimits map[protocol.ID]rcmgr.LimitVal) (network.ResourceManager, error) {
	scalingLimits := rcmgr.DefaultLimits

	// Add limits around included libp2p protocols
	libp2p.SetDefaultServiceLimits(&scalingLimits)

	// Turn the scaling limits into a concrete set of limits using `.AutoScale`. This
	// scales the limits proportional to your system memory.
	scaledDefaultLimits := scalingLimits.AutoScale()
	const (
		maxConns           = 2500
		maxFileDescriptors = 3000
		maxMemory          = 2048 * 1024 * 1024
	)

	absoluteLimits := rcmgr.ResourceLimits{
		Streams:         maxConns,
		StreamsInbound:  maxConns,
		StreamsOutbound: maxConns,
		Conns:           maxConns,
		ConnsInbound:    maxConns,
		ConnsOutbound:   maxConns,
		FD:              maxFileDescriptors,
		Memory:          maxMemory,
	}

	protocolsLimits := map[protocol.ID]rcmgr.ResourceLimits{}
	for name, limit := range ourProtocolLimits {
		if limit > maxConns {
			return nil, fmt.Errorf("Provided limit %d can't be greater than absolute limit %d", limit, maxConns)
		}
		limits := rcmgr.ResourceLimits{
			Streams:         limit,
			StreamsInbound:  limit,
			StreamsOutbound: limit,
			Conns:           limit,
			ConnsInbound:    limit,
			ConnsOutbound:   limit,
			FD:              maxFileDescriptors,
			Memory:          maxMemory,
		}

		protocolsLimits[name] = limits
	}
	for name, limit := range theirProtocolLimits {
		if limit > maxConns {
			return nil, fmt.Errorf("Provided limit %d can't be greater than absolute limit %d", limit, maxConns)
		}
		limits := rcmgr.ResourceLimits{
			Streams:         limit,
			StreamsInbound:  limit,
			StreamsOutbound: limit,
			Conns:           limit,
			ConnsInbound:    limit,
			ConnsOutbound:   limit,
			FD:              maxFileDescriptors,
			Memory:          maxMemory,
		}

		protocolsLimits[name] = limits
	}

	// Defaults
	cfg := rcmgr.PartialLimitConfig{
		System:               absoluteLimits,
		Transient:            absoluteLimits,
		AllowlistedSystem:    absoluteLimits,
		AllowlistedTransient: absoluteLimits,
		ServiceDefault:       absoluteLimits,
		//Service:              map[string]rcmgr.ResourceLimits{},
		ServicePeerDefault: absoluteLimits,
		//ServicePeer:          map[string]rcmgr.ResourceLimits{},
		ProtocolDefault:     absoluteLimits,
		Protocol:            protocolsLimits,
		ProtocolPeerDefault: absoluteLimits,
		//ProtocolPeer:         map[protocol.ID]rcmgr.ResourceLimits{},
		PeerDefault: absoluteLimits,
		//Peer:                 map[peer.ID]rcmgr.ResourceLimits{},
		Conn:   absoluteLimits,
		Stream: absoluteLimits,
	}

	limits := cfg.Build(scaledDefaultLimits)

	// The resource manager expects a limiter, so we create one from our limits.
	limiter := rcmgr.NewFixedLimiter(limits)

	return rcmgr.NewResourceManager(limiter)
}
