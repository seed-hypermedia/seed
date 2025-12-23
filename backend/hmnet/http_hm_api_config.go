package hmnet

import (
	"encoding/json"
	"net/http"
	"seed/backend/blob"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
)

// HMAPIConfigResponse is the response returned by the /hm/api/config endpoint.
// It embeds blob.SiteConfigResponse and adds protocol-specific fields.
type HMAPIConfigResponse struct {
	blob.SiteConfigResponse
	ProtocolID protocol.ID `json:"protocolId"`
}

// HMAPIConfigHandler is a handler for the conventional `/hm/api/config` route,
// which is usually provided by the web middle end server, but sometimes (especially in testing environments),
// we may need it to support libp2p connections via web URL.
func (n *Node) HMAPIConfigHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		info := n.AddrInfo()
		mas, err := peer.AddrInfoToP2pAddrs(&info)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := HMAPIConfigResponse{
			SiteConfigResponse: blob.SiteConfigResponse{
				PeerID: n.p2p.ID().String(),
				Addrs:  mas,
			},
			ProtocolID: n.ProtocolID(),
		}

		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		_ = enc.Encode(resp)
	})
}
