package ipfs

import (
	"context"
	"fmt"

	"seed/backend/util/cleanup"
	"seed/backend/util/must"

	"github.com/ipfs/boxo/ipns"
	"github.com/ipfs/go-datastore"
	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	dualdht "github.com/libp2p/go-libp2p-kad-dht/dual"
	"github.com/libp2p/go-libp2p-kad-dht/providers"
	record "github.com/libp2p/go-libp2p-record"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	routing "github.com/libp2p/go-libp2p/core/routing"
	rcmgr "github.com/libp2p/go-libp2p/p2p/host/resource-manager"
	"github.com/libp2p/go-libp2p/p2p/net/connmgr"
	"github.com/multiformats/go-multiaddr"
	"go.uber.org/multierr"
)

// Libp2p exposes libp2p host and the underlying routing system (DHT).
// It provides some reasonable defaults, and also handles shutdown more gracefully.
type Libp2p struct {
	host.Host

	ds      datastore.Batching
	Routing routing.Routing

	clean cleanup.Stack
}

// NewLibp2pNode creates a new node. It's a convenience wrapper around the main libp2p package.
// It forces one to pass the peer private key and datastore.
// To the default options of the libp2p package it also adds DHT Routing, Connection Manager, Relay protocol support.
// To actually enable relay you also need to pass EnableAutoRelay, and optionally enable HolePunching.
// The returning node won't be listening on the network by default, so users have to start listening manually,
// using the Listen() method on the underlying P2P network.
func NewLibp2pNode(key crypto.PrivKey, ds datastore.Batching, protocolID protocol.ID, opts ...libp2p.Option) (n *Libp2p, err error) {
	n = &Libp2p{
		ds: ds,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer func() {
		if err != nil {
			err = multierr.Append(err, n.Close())
		}
	}()
	n.clean.AddErrFunc(func() error {
		cancel()
		return nil
	})

	rm, err := buildResourceManager(map[protocol.ID]rcmgr.LimitVal{protocolID: 2000},
		map[protocol.ID]rcmgr.LimitVal{"/ipfs/kad/1.0.0": 5000, "/ipfs/bitswap/1.2.0": 3000})
	if err != nil {
		return nil, err
	}

	o := []libp2p.Option{
		libp2p.Identity(key),
		libp2p.NoListenAddrs,      // Users must explicitly start listening.
		libp2p.EnableRelay(),      // Be able to dial behind-relay peers and receive connections from them.
		libp2p.EnableNATService(), // Dial other peers on-demand to let them know if they are reachable.
		libp2p.ConnectionManager(must.Do2(connmgr.NewConnManager(50, 100))),
		libp2p.ResourceManager(rm),
		libp2p.Routing(func(h host.Host) (routing.PeerRouting, error) {
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
			n.clean.Add(provStore)

			r, err := dualdht.New(
				ctx, h,
				dualdht.DHTOption(
					dht.Concurrency(10),
					dht.Mode(dht.ModeAuto),
					dht.ProviderStore(provStore),
					dht.Datastore(ds),
					dht.Validator(record.NamespacedValidator{
						"pk":   record.PublicKeyValidator{},
						"ipns": ipns.Validator{KeyBook: h.Peerstore()},
					}),
				),
				// LAN DHT should always be in server mode.
				dualdht.LanDHTOption(dht.Mode(dht.ModeServer)),
			)
			if err != nil {
				return nil, err
			}

			// Routing interface from IPFS doesn't expose Close method,
			// so it actually never gets closed properly, even inside IPFS.
			// This ugly trick attempts to solve this.
			// n.clean.Add(r)
			n.clean.AddErrFunc(func() error {
				return r.Close()
			})

			n.Routing = &instrumentedRouting{r}

			return n.Routing, nil
		}),
	}

	o = append(o, opts...)

	n.Host, err = libp2p.New(o...)
	if err != nil {
		return nil, err
	}
	n.clean.Add(n.Host)

	return n, nil
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
		maxConns           = 12000
		maxFileDescriptors = 5000
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
