package hmnet

import (
	"cmp"
	"encoding/json"
	"maps"
	"net/http"
	"reflect"
	"seed/backend/ipfs"
	"seed/backend/util/libp2px"
	"slices"
	"sync"

	"github.com/libp2p/go-libp2p/core/connmgr"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
	"github.com/libp2p/go-libp2p/core/protocol"
)

func (n *Node) DebugHandler() http.Handler {
	var (
		once sync.Once
		cmgr *unsafeConnManager
	)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() {
			cmgr = unwrapConnManager(n.p2p.Host.ConnManager())
		})

		connectedPeers := n.p2p.Network().Peers()
		allPeers := n.p2p.Peerstore().Peers()

		protocols := n.p2p.Mux().Protocols()
		slices.Sort(protocols)
		out := debugInfo{
			AddrInfo:           libp2px.AddrInfo(n.p2p.Host),
			HypermediaProtocol: n.ProtocolID(),
			Libp2pProtocols:    protocols,
			Reachability:       n.currentReachability.Load().(network.Reachability).String(),
			ConnectedPeers:     len(connectedPeers),
			HypermediaPeers:    countHypermediaPeers(connectedPeers, n.p2p.Peerstore(), n.protocol.ID),
			PeerstorePeers:     len(allPeers),
			BitswapInfo:        getBitswapInfo(n.bitswap),
		}

		if !r.URL.Query().Has("short") {
			info := getConnManagerInfo(allPeers, cmgr)
			info.LimitExceeded = cmgr.CheckLimit(n.p2p) != nil
			out.ConnManagerInfo = &info
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

type debugInfo struct {
	AddrInfo           peer.AddrInfo
	HypermediaProtocol protocol.ID
	Libp2pProtocols    []protocol.ID
	Reachability       string
	ConnectedPeers     int
	HypermediaPeers    int
	PeerstorePeers     int
	BitswapInfo        *bitswapInfo     `json:",omitempty"`
	ConnManagerInfo    *connManagerInfo `json:",omitempty"`
}

type bitswapInfo struct {
	BlocksReceived uint64
	BlocksSent     uint64
	ProvideBufLen  int
	Peers          []string
}
type connManagerInfo struct {
	TotalPeers         int
	ShownPeers         int
	LimitExceeded      bool
	PeersPerTag        map[string]int
	PeersPerProtection map[string]int
	Peers              []connManagerPeerInfo
}

type connManagerPeerInfo struct {
	PeerID        peer.ID
	TagInfo       *connmgr.TagInfo
	ProtectedTags []string
}

func getBitswapInfo(bs *ipfs.Bitswap) *bitswapInfo {
	ret := &bitswapInfo{}
	info, err := bs.Stat()
	if err != nil {
		return ret
	}
	ret.BlocksReceived = info.BlocksReceived
	ret.BlocksSent = info.BlocksSent
	ret.ProvideBufLen = info.ProvideBufLen
	ret.Peers = info.Peers
	return ret
}

func getConnManagerInfo(allPeers []peer.ID, cmgr *unsafeConnManager) connManagerInfo {
	out := connManagerInfo{
		Peers:              make([]connManagerPeerInfo, 0, len(allPeers)),
		PeersPerTag:        make(map[string]int),
		PeersPerProtection: make(map[string]int),
	}
	protectedPeers := cmgr.getProtectedPeers()
	for _, pid := range allPeers {
		info := cmgr.GetTagInfo(pid)
		isProtected := cmgr.IsProtected(pid, "")

		// No info in connmgr.
		if info == nil && !isProtected {
			continue
		}

		out.TotalPeers++

		// Some info in connmgr, but we don't expose it as it's not very useful.
		if info != nil && len(info.Tags) == 0 && !isProtected {
			continue
		}

		out.ShownPeers++

		tagInfo := cmgr.GetTagInfo(pid)

		out.Peers = append(out.Peers, connManagerPeerInfo{
			PeerID:        pid,
			TagInfo:       tagInfo,
			ProtectedTags: protectedPeers[pid],
		})

		if tagInfo != nil {
			for tag := range tagInfo.Tags {
				out.PeersPerTag[tag]++
			}
		}
	}

	for _, tags := range protectedPeers {
		for _, tag := range tags {
			out.PeersPerProtection[tag]++
		}
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

type unsafeConnManager struct {
	connmgr.ConnManager

	// Private fields from the BasicConnManager that we extract with reflection,
	// to have access to the keys of protected peers.
	// This is a terrible, terrible hack, and it will break if the internal structure of BasicConnManager changes.
	// We have a test that checks that this works, so we should detect any problems when/if they happen.
	plk       *sync.RWMutex
	protected map[peer.ID]map[string]struct{}
}

func unwrapConnManager(cmgr connmgr.ConnManager) *unsafeConnManager {
	var (
		lockType      = reflect.TypeOf(sync.RWMutex{})
		protectedType = reflect.TypeOf(map[peer.ID]map[string]struct{}{})
	)

	rv := reflect.ValueOf(cmgr)

	rplk := rv.Elem().FieldByName("plk")
	if rplk.Type() != lockType {
		panic("BUG: unexpected type plk")
	}

	rprotected := rv.Elem().FieldByName("protected")
	if rprotected.Type() != protectedType {
		panic("BUG: unexpected type protected")
	}

	plk := (*sync.RWMutex)(rplk.Addr().UnsafePointer())
	protected := *(*map[peer.ID]map[string]struct{})(rprotected.Addr().UnsafePointer())

	return &unsafeConnManager{
		ConnManager: cmgr,
		plk:         plk,
		protected:   protected,
	}
}

func (cmgr *unsafeConnManager) getProtectedPeers() map[peer.ID][]string {
	cmgr.plk.RLock()
	defer cmgr.plk.RUnlock()

	out := make(map[peer.ID][]string, len(cmgr.protected))
	for k := range cmgr.protected {
		out[k] = slices.Collect(maps.Keys(cmgr.protected[k]))
	}

	return out
}
