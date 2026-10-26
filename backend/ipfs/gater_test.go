package ipfs

import (
	"context"
	"seed/backend/logging"
	"testing"
	"time"

	"github.com/ipfs/go-datastore"
	"github.com/ipfs/go-datastore/sync"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/host/peerstore/pstoremem"
	"github.com/multiformats/go-multiaddr"
	"github.com/stretchr/testify/require"
)

func TestGaterIsolated(t *testing.T) {
	ps, err := pstoremem.NewPeerstore()
	require.NoError(t, err)

	pid, err := peer.Decode("12D3KooWNmjM4sMbSkDEA6ShvjTgkrJHjMya46fhZ9PjKZ4KVZYq")
	require.NoError(t, err)
	addr, err := multiaddr.NewMultiaddr("/ip4/127.0.0.1/tcp/4002")
	require.NoError(t, err)

	open := newGater(ps, false)
	require.True(t, open.InterceptPeerDial(pid))
	require.True(t, open.InterceptAddrDial(pid, addr))
	require.True(t, open.InterceptAccept(nil))
	require.True(t, open.InterceptSecured(network.DirInbound, pid, nil))
	allow, _ := open.InterceptUpgraded(nil)
	require.True(t, allow)

	isolated := newGater(ps, true)
	require.False(t, isolated.InterceptPeerDial(pid))
	require.False(t, isolated.InterceptAddrDial(pid, addr))
	require.False(t, isolated.InterceptAccept(nil))
	require.False(t, isolated.InterceptSecured(network.DirInbound, pid, nil))
	allow, _ = isolated.InterceptUpgraded(nil)
	require.False(t, allow)
}

// TestIsolatedNodeDeniesConnections boots a real isolated host next to a normal
// one and checks that neither direction can connect.
func TestIsolatedNodeDeniesConnections(t *testing.T) {
	alice := makePeer(t, akey)
	bob := makeIsolatedHost(t, bkey)

	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()

	require.Error(t, bob.Connect(ctx, alice.AddrInfo()), "isolated node must not dial out")
	require.Equal(t, network.NotConnected, bob.Network().Connectedness(alice.ID()))

	require.Error(t, alice.Connect(ctx, bob.AddrInfo()), "isolated node must not accept inbound connections")
	require.Equal(t, network.NotConnected, bob.Network().Connectedness(alice.ID()))
	require.Equal(t, network.NotConnected, alice.Network().Connectedness(bob.ID()))
}

func makeIsolatedHost(t *testing.T, k crypto.PrivKey) *Libp2p {
	t.Helper()

	ds := sync.MutexWrap(datastore.NewMapDatastore())
	t.Cleanup(func() { require.NoError(t, ds.Close()) })
	ps, err := pstoremem.NewPeerstore()
	require.NoError(t, err)

	n, err := NewLibp2pNode(k, ds, ps, "/hypermedia/0.4.1", "", true, logging.New("test", "debug"), nil)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, n.Close()) })

	ma, err := multiaddr.NewMultiaddr("/ip4/127.0.0.1/tcp/0")
	require.NoError(t, err)
	require.NoError(t, n.Network().Listen(ma))

	return n
}
