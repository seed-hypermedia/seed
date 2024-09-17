// NOTE: copied from go-ipfs/config/bootstrap_peers.go

package ipfs

import (
	"cmp"
	"maps"
	"slices"

	"github.com/libp2p/go-libp2p/core/peer"
)

// DefaultBootstrapAddresses are the hardcoded bootstrap addresses
// for IPFS. they are nodes run by the IPFS team. docs on these later.
// As with all p2p networks, bootstrap is an important security concern.
//
// NOTE: This is here -- and not inside cmd/ipfs/init.go -- because of an
// import dependency issue. TODO: move this into a config/default/ package.
const (
	HM24TestGateway       = "/dns4/test.hyper.media/tcp/56000/p2p/12D3KooWMjs8x6ST53ZuXAegedQ4dJ2HYYQmFpw1puGpBZmLRCGB"
	HM24ProductionGateway = "/dns4/gateway.hyper.media/tcp/56000/p2p/12D3KooWLyw3zApBMKK2BbtjgHPmtr4iqqJkY8nUGYs92oM2bzgR"
)

// DefaultBootstrapAddresses are the addresses to use as a gate to the network.
var DefaultBootstrapAddresses = []string{
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
	"/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
	"/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",         // mars.i.ipfs.io
	"/ip4/104.131.131.82/udp/4001/quic-v1/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ", // mars.i.ipfs.io
	HM24ProductionGateway,
	HM24TestGateway,
}

var DefaultBootstrapAddrInfos []peer.AddrInfo

func init() {
	infos := map[peer.ID]peer.AddrInfo{}
	for _, addr := range DefaultBootstrapAddresses {
		ai, err := peer.AddrInfoFromString(addr)
		if err != nil {
			panic(err)
		}
		if _, ok := infos[ai.ID]; !ok {
			infos[ai.ID] = *ai
		} else {
			old := infos[ai.ID]
			old.Addrs = append(infos[ai.ID].Addrs, ai.Addrs...)
			infos[ai.ID] = old
		}
	}

	DefaultBootstrapAddrInfos = slices.Collect(maps.Values(infos))
	slices.SortFunc(DefaultBootstrapAddrInfos, func(a, b peer.AddrInfo) int {
		return cmp.Compare(a.ID, b.ID)
	})
}
