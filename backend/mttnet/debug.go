package mttnet

import (
	"cmp"
	"encoding/json"
	"net/http"
	"seed/backend/util/libp2px"
	"slices"

	"github.com/libp2p/go-libp2p/core/connmgr"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
	"github.com/libp2p/go-libp2p/core/protocol"
)

type debugInfo struct {
	AddrInfo             peer.AddrInfo
	HypermediaProtocol   protocol.ID
	Libp2pProtocols      []protocol.ID
	Reachability         string
	ConnectedPeersCount  int
	HypermediaPeersCount int
	PeerstorePeersCount  int
	ConnManagerInfo      connManagerInfo
}

type connManagerInfo struct {
	TotalPeersCount int
	ShownPeersCount int
	Peers           []connManagerPeerInfo
}

type connManagerPeerInfo struct {
	PeerID      peer.ID
	TagInfo     *connmgr.TagInfo
	IsProtected bool
}

func (n *Node) DebugHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connectedPeers := n.p2p.Network().Peers()
		allPeers := n.p2p.Peerstore().Peers()

		protocols := n.p2p.Mux().Protocols()
		slices.Sort(protocols)

		out := debugInfo{
			AddrInfo:             libp2px.AddrInfo(n.p2p.Host),
			HypermediaProtocol:   n.ProtocolID(),
			Libp2pProtocols:      protocols,
			Reachability:         n.currentReachability.Load().(network.Reachability).String(),
			ConnectedPeersCount:  len(connectedPeers),
			HypermediaPeersCount: countHypermediaPeers(connectedPeers, n.p2p.Peerstore(), n.protocol.ID),
			PeerstorePeersCount:  len(n.p2p.Peerstore().Peers()),
			ConnManagerInfo:      getConnManagerInfo(allPeers, n.p2p.ConnManager()),
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

func getConnManagerInfo(allPeers []peer.ID, cmgr connmgr.ConnManager) connManagerInfo {
	out := connManagerInfo{
		Peers: make([]connManagerPeerInfo, 0, len(allPeers)),
	}

	for _, pid := range allPeers {
		info := cmgr.GetTagInfo(pid)
		isProtected := cmgr.IsProtected(pid, "")

		// No info in connmgr.
		if info == nil && !isProtected {
			continue
		}

		out.TotalPeersCount++

		// Some info in connmgr, but we don't expose it as it's not very useful.
		if info != nil && len(info.Tags) == 0 && !isProtected {
			continue
		}

		out.ShownPeersCount++
		out.Peers = append(out.Peers, connManagerPeerInfo{
			PeerID:      pid,
			TagInfo:     cmgr.GetTagInfo(pid),
			IsProtected: cmgr.IsProtected(pid, ""),
		})
	}

	slices.SortFunc(out.Peers, func(a, b connManagerPeerInfo) int {
		return cmp.Compare(a.PeerID, b.PeerID)
	})

	return out
}

func countHypermediaPeers(connected []peer.ID, ps peerstore.Peerstore, wantedProtocol protocol.ID) int {
	var count int
	for _, pid := range connected {
		got, err := ps.FirstSupportedProtocol(pid, wantedProtocol)
		if err != nil {
			continue
		}
		if got == "" {
			continue
		}
		count++
	}
	return count
}
