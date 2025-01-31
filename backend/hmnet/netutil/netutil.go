// Package netutil has some common P2P-related code.
// It shouldn't exist, it's just here while we are refactoring the package,
// to avoid cyclical dependencies.
package netutil

import (
	"fmt"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
)

// ConnectTimeout is the maximum time to spend connecting to a peer.
const ConnectTimeout = time.Minute

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
