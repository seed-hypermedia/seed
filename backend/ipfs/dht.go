package ipfs

import (
	"context"
	"fmt"
	"seed/backend/util/cleanup"

	"github.com/ipfs/go-cid"
	"github.com/ipfs/go-datastore"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p-kad-dht/records"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	manet "github.com/multiformats/go-multiaddr/net"
)

var errNotImplemented = fmt.Errorf("Method not implemented")

type noopDHT struct{}

func newDHT(ctx context.Context, h host.Host, ds datastore.Batching, clean cleanup.Stack) (*dht.IpfsDHT, error) {
	if ds == nil {
		panic("BUG: must provide datastore for DHT")
	}

	// The DHT code creates this automatically to store providing records,
	// but the problem is that it doesn't close it properly. When this provider
	// manager wants to flush records into the database, we would have closed the database
	// already. Because of this we always have an annoying error during our shutdown.
	// Here we manually ensure all the goroutines started by provider manager are closed.
	provStore, err := records.NewProviderManager(ctx, h.ID(), h.Peerstore(), ds)
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

	return fullDHT, nil
}

func (n *noopDHT) Provide(context.Context, cid.Cid, bool) error {
	return errNotImplemented
}

func (n *noopDHT) FindPeer(context.Context, peer.ID) (peer.AddrInfo, error) {
	return peer.AddrInfo{}, errNotImplemented
}

func (n *noopDHT) FindProvidersAsync(context.Context, cid.Cid, int) (ch <-chan peer.AddrInfo) {
	return nil
}
