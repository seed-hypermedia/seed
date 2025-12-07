package hmnet

import (
	"encoding/json"
	"net/http"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/multiformats/go-multiaddr"
)

type HMAPIConfigResponse struct {
	PeerID     string                `json:"peerId"`
	ProtocolID protocol.ID           `json:"protocolId"`
	Addrs      []multiaddr.Multiaddr `json:"addrs"`
}

// HMAPIConfigHandler is a handler for the conventional `/hm/api/config` route,
// which is usually provided by the web middle end server, but sometimes (especially in testing environments),
// we may need it to support libp2p connections via web URL.
func (n *Node) HMAPIConfigHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		info := n.AddrInfo()
		mas, err := peer.AddrInfoToP2pAddrs(&info)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := HMAPIConfigResponse{
			PeerID:     n.p2p.ID().String(),
			ProtocolID: n.ProtocolID(),
			Addrs:      mas,
		}

		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		_ = enc.Encode(resp)
	})
}
