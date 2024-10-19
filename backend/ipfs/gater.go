package ipfs

import (
	"github.com/libp2p/go-libp2p/core/connmgr"
	"github.com/libp2p/go-libp2p/core/control"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
	ma "github.com/multiformats/go-multiaddr"
)

type gater struct {
	peerstore.Peerstore
}

func newGater(ps peerstore.Peerstore) connmgr.ConnectionGater {
	return &gater{ps}
}

// InterceptPeerDial tests whether we're permitted to Dial the specified peer.
//
// This is called by the network.Network implementation when dialling a peer.
func (cg *gater) InterceptPeerDial(_ peer.ID) bool {
	return true
}

// InterceptAddrDial tests whether we're permitted to dial the specified
// multiaddr for the given peer.
//
// This is called by the network.Network implementation after it has
// resolved the peer's addrs, and prior to dialling each.
func (cg *gater) InterceptAddrDial(_ peer.ID, _ ma.Multiaddr) (allow bool) {
	return true
}

// InterceptAccept tests whether an incipient inbound connection is allowed.
//
// This is called by the upgrader, or by the transport directly (e.g. QUIC,
// Bluetooth), straight after it has accepted a connection from its socket.
func (cg *gater) InterceptAccept(_ network.ConnMultiaddrs) (allow bool) {
	return true
}

// InterceptSecured tests whether a given connection, now authenticated,
// is allowed.
//
// This is called by the upgrader, after it has performed the security
// handshake, and before it negotiates the muxer, or by the directly by the
// transport, at the exact same checkpoint.
func (cg *gater) InterceptSecured(_ network.Direction, _ peer.ID, _ network.ConnMultiaddrs) (allow bool) {
	return true
	/*
		protocols, err := cg.Peerstore.GetProtocols(p)
		if err != nil {
			fmt.Println("Gater Error", err.Error())
			return false
		}
		if len(protocols) == 0 {
			return true
		}
		for _, p := range protocols {
			if p == "/hypermedia/0.7.0-dev" {
				return true
			}
		}
		fmt.Println("Gater Not allowing non-seed connections Protocol length", len(protocols))
		return false
	*/
}

// InterceptUpgraded tests whether a fully capable connection is allowed.
//
// At this point, the connection a multiplexer has been selected.
// When rejecting a connection, the gater can return a DisconnectReason.
// Refer to the godoc on the ConnectionGater type for more information.
//
// NOTE: the go-libp2p implementation currently IGNORES the disconnect reason.
func (cg *gater) InterceptUpgraded(_ network.Conn) (allow bool, reason control.DisconnectReason) {
	/*
		protocols, err := cg.Peerstore.GetProtocols(a.RemotePeer())
		if err != nil {
			fmt.Println("Gater InterceptUpgraded Error", err.Error())
			return false, 0
		}
		a.Scope().Stat()

		for _, p := range protocols {
			if p == "/hypermedia/0.7.0-dev" {
				return true, 0
			}
		}
		fmt.Println("Gater InterceptUpgraded Not allowing non-seed connections Protocol length", len(protocols))
		return false, 0
	*/
	return true, 0
}
