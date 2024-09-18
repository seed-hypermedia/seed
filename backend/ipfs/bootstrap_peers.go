package ipfs

import "github.com/multiformats/go-multiaddr"

// Copied from https://github.com/ipfs/kubo/blob/master/config/bootstrap_peers.go.
// Additional servers should be specified elsewhere.

var defaultBootstrapAddresses = []string{
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
	"/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",         // mars.i.ipfs.io
	"/ip4/104.131.131.82/udp/4001/quic-v1/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ", // mars.i.ipfs.io
}

// DefaultBootstrapPeers exposes default bootstrap peers from the go-ipfs package,
// failing in case of an error, which should only happen if there's a bug somewhere.
func DefaultBootstrapPeers() []multiaddr.Multiaddr {
	out := make([]multiaddr.Multiaddr, len(defaultBootstrapAddresses))

	for i, a := range defaultBootstrapAddresses {
		addr, err := multiaddr.NewMultiaddr(a)
		if err != nil {
			panic(err)
		}
		out[i] = addr
	}

	return out
}
