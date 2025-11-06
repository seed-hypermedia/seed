package ipfs

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"seed/backend/util/cleanup"
	"seed/backend/util/must"

	delegated_routing "github.com/ipfs/boxo/routing/http/client"
	content_routing "github.com/ipfs/boxo/routing/http/contentrouter"
	"github.com/ipfs/go-cid"
	"github.com/ipfs/go-datastore"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
	"github.com/libp2p/go-libp2p/core/protocol"
	routing "github.com/libp2p/go-libp2p/core/routing"
	rcmgr "github.com/libp2p/go-libp2p/p2p/host/resource-manager"
	"github.com/libp2p/go-libp2p/p2p/net/connmgr"
	"github.com/libp2p/go-libp2p/x/rate"
	"github.com/multiformats/go-multiaddr"
	"go.uber.org/zap"
)

const (
	highWatermark = 300
	lowWatermark  = 150
)

// Libp2p exposes libp2p host and the underlying routing system (DHT).
// It provides some reasonable defaults, and also handles shutdown more gracefully.
type Libp2p struct {
	host.Host

	ds      datastore.Batching
	Routing Routing

	clean cleanup.Stack
}

type Routing interface {
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
func NewLibp2pNode(key crypto.PrivKey, ds datastore.Batching, ps peerstore.Peerstore, protocolID protocol.ID, delegatedDHTURL string, log *zap.Logger, opts ...libp2p.Option) (nn *Libp2p, err error) {
	var clean cleanup.Stack
	const unlimitedResources = true
	defer func() {
		if err != nil {
			err = errors.Join(err, clean.Close())
		}
	}()
	rm, err := buildResourceManager(
		map[protocol.ID]rcmgr.LimitVal{
			protocolID: 2000,
		},
		map[protocol.ID]rcmgr.LimitVal{
			"/ipfs/kad/1.0.0":     2000,
			"/ipfs/bitswap/1.2.0": 2000,
		},
		unlimitedResources)
	if err != nil {
		return nil, err
	}
	var rt Routing
	cm := must.Do2(connmgr.NewConnManager(lowWatermark, highWatermark,
		connmgr.WithGracePeriod(5*time.Second),
		connmgr.WithSilencePeriod(6*time.Second)))

	pid, err := peer.IDFromPublicKey(key.GetPublic())
	if err != nil {
		return nil, err
	}

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
		libp2p.Peerstore(ps),
		libp2p.ConnectionManager(cm),
		libp2p.ResourceManager(rm),
		libp2p.ConnectionGater(newGater(ps)),
		libp2p.Routing(func(h host.Host) (routing.PeerRouting, error) {
			client, err := delegated_routing.New(delegatedDHTURL,
				delegated_routing.WithHTTPClient(delegateHTTPClient),
				delegated_routing.WithIdentity(key),
				delegated_routing.WithUserAgent("seed-hypermedia"),
				delegated_routing.WithProviderInfo(pid, nil), //TODO(juligasa): add address info
				delegated_routing.WithDisabledLocalFiltering(false),
			)
			if err != nil {
				return nil, err
			}
			rt = content_routing.NewContentRoutingClient(client)
			return rt, nil
		}),
	}

	o = append(o, opts...)

	node, err := libp2p.New(o...)
	if err != nil {
		return nil, err
	}
	node = &libp2pWrapper{node}
	clean.Add(node)

	return &Libp2p{
		ds:      ds,
		clean:   clean,
		Host:    node,
		Routing: rt,
	}, nil
}

type libp2pWrapper struct {
	host.Host
}

func (lw *libp2pWrapper) Connect(ctx context.Context, pinfo peer.AddrInfo) error {
	if lw.Network().Connectedness(pinfo.ID) == network.Connected {
		return nil
	}

	return lw.Host.Connect(ctx, pinfo)
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
func buildResourceManager(ourProtocolLimits map[protocol.ID]rcmgr.LimitVal, theirProtocolLimits map[protocol.ID]rcmgr.LimitVal, unlimited bool) (network.ResourceManager, error) {
	scalingLimits := rcmgr.DefaultLimits

	// Add limits around included libp2p protocols
	libp2p.SetDefaultServiceLimits(&scalingLimits)

	// Turn the scaling limits into a concrete set of limits using `.AutoScale`. This
	// scales the limits proportional to your system memory.
	limits := rcmgr.InfiniteLimits
	unlimitedLimiter := rate.Limiter{GlobalLimit: rate.Limit{RPS: float64(math.MaxInt64), Burst: math.MaxInt64}}
	opts := rcmgr.WithConnRateLimiters(&unlimitedLimiter)
	if !unlimited {
		scaledDefaultLimits := scalingLimits.AutoScale()
		const (
			maxConns           = 5000
			maxFileDescriptors = 6000
			maxMemory          = 8192 * 1024 * 1024 // 8GB
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
		limits = cfg.Build(scaledDefaultLimits)
	}

	// The resource manager expects a limiter, so we create one from our limits.
	limiter := rcmgr.NewFixedLimiter(limits)
	var rm network.ResourceManager
	var err error

	if unlimited {
		rm, err = rcmgr.NewResourceManager(limiter, opts)

	} else {
		rm, err = rcmgr.NewResourceManager(limiter)

	}
	if err != nil {
		return nil, err
	}
	return rm, nil
}
