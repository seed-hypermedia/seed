package mttnet

import (
	"encoding/json"
	"net/http"
	"seed/backend/util/libp2px"
	"slices"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
)

type debugInfo struct {
	AddrInfo                 peer.AddrInfo
	HypermediaProtocol       protocol.ID
	Libp2pProtocols          []protocol.ID
	Reachability             string
	TotalPeersConnected      int
	HypermediaPeersConnected int
}

func (n *Node) DebugHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		totalPeers := n.p2p.Network().Peers()

		protocols := n.p2p.Mux().Protocols()
		slices.Sort(protocols)

		out := debugInfo{
			AddrInfo:            libp2px.AddrInfo(n.p2p.Host),
			HypermediaProtocol:  n.ProtocolID(),
			Libp2pProtocols:     protocols,
			TotalPeersConnected: len(totalPeers),
			Reachability:        n.currentReachability.Load().(network.Reachability).String(),
		}

		for _, pid := range totalPeers {
			got, err := n.p2p.Peerstore().FirstSupportedProtocol(pid, n.protocol.ID)
			if err != nil {
				continue
			}
			if got == "" {
				continue
			}
			out.HypermediaPeersConnected++
		}

		enc := json.NewEncoder(w)
		enc.SetIndent("", "    ")
		w.Header().Set("Content-Type", "application/json")
		if err := enc.Encode(out); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	})
}
