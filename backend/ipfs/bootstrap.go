package ipfs

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/net/swarm"
)

const (
	// ProductionGatewayPID is the Peer id of the production gateway
	ProductionGatewayPID = "12D3KooWEDdEeuY3oHCSKtn1eC7tU9qNWjF9bb8sCtHzpuCjvomQ"
	// TestGatewayPID is the peer id of the test gateway
	TestGatewayPID = "12D3KooWMjs8x6ST53ZuXAegedQ4dJ2HYYQmFpw1puGpBZmLRCGB"

	bootstrapSupportKey = "bootstrap-support" // This is what we use as a key to protect the connection in ConnManager.
)

// BootstrapResult is a result of the bootstrap process.
type BootstrapResult struct {
	// Peers that were used for bootstrapping.
	Peers []peer.AddrInfo
	// ConnectErrs is a list of results from the
	// Connect() call for all the peers in the input order.
	ConnectErrs []error
	// RoutingErr is the result of the bootstrap call
	// from the routing system.
	RoutingErr error
	// NumFailedConnection is the number of total failed connect calls.
	NumFailedConnections uint32
}

// PeriodicBootstrap blocks and periodically performs the bootsrapping process.
func PeriodicBootstrap(
	ctx context.Context,
	h host.Host,
	peersfn func() []peer.AddrInfo,
	callback func(context.Context, BootstrapResult),
) {
	const (
		connectTimeout           = 10 * time.Second
		bootstrapInterval        = 30 * time.Second // Bootstrapping is cheap so can be repeated often.
		successBootstrapInterval = 1 * time.Minute  // When all bootstrapped nodes are connected we still try to reconnect in case some of the go offline
		minPeers                 = 10               // If we have less than this peers connected, we try to bootstrap more.
	)

	t := time.NewTimer(1)
	defer t.Stop()

	var wg sync.WaitGroup
	defer wg.Wait()

	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			prodGwPID, err := peer.Decode(ProductionGatewayPID)
			testGwPID, err2 := peer.Decode(TestGatewayPID)
			if len(h.Network().Peers()) >= minPeers &&
				err == nil && h.Network().Connectedness(prodGwPID) == network.Connected &&
				err2 == nil && h.Network().Connectedness(testGwPID) == network.Connected {
				t.Reset(successBootstrapInterval)
				continue
			}

			peers := peersfn()

			res := BootstrapResult{
				Peers:       peers,
				ConnectErrs: make([]error, len(peers)),
			}

			for i, pinfo := range peers {
				wg.Add(1)
				go func(i int, pinfo peer.AddrInfo) {
					defer wg.Done()

					// Since we're explicitly connecting to a peer, we want to clear any backoffs
					// that the network might have at the moment.
					{
						sw, ok := h.Network().(*swarm.Swarm)
						if ok {
							sw.Backoff().Clear(pinfo.ID)
						}
					}
					ctx, cancel := context.WithTimeout(ctx, connectTimeout)
					defer cancel()

					err := h.Connect(network.WithForceDirectDial(ctx, "bootstrapping"), pinfo)
					if err != nil {
						atomic.AddUint32(&res.NumFailedConnections, 1)
						res.ConnectErrs[i] = fmt.Errorf("bootstrap failed: %s: %w", pinfo.ID, err)
					}
					h.ConnManager().Protect(pinfo.ID, bootstrapSupportKey)
				}(i, pinfo)
			}

			wg.Wait()

			if callback != nil {
				callback(ctx, res)
			}

			t.Reset(bootstrapInterval)
		}
	}
}
