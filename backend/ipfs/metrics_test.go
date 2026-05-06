package ipfs

import (
	"context"
	"testing"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/require"
)

// TestLibp2pMetrics_ScopeFromConnections drives two real libp2p nodes through a
// loopback connection and verifies the metrics object correctly classifies the
// peer as loopback once Connected fires.
func TestLibp2pMetrics_ScopeFromConnections(t *testing.T) {
	alice := makePeer(t, akey)
	bob := makePeer(t, bkey)

	m := NewLibp2pMetrics()
	m.SetHost(alice.Host)
	alice.Network().Notify(m)

	ctx := context.Background()
	require.NoError(t, alice.Connect(ctx, bob.AddrInfo()))

	// Once Connect returns the conn exists and Notifiee.Connected fired.
	bobID := bob.Host.ID()
	require.True(t, m.PeerIsLoopback(bobID),
		"alice ↔ bob over /ip4/0.0.0.0 listener accepted on 127.0.0.1 must be classified as loopback")
}

// TestLibp2pMetrics_RecordStreamUpdatesPeerBytes synthesizes an inbound stream
// message and verifies the per-peer book-keeping records bytes and last
// activity. We use the BandwidthReporter API directly because we can't easily
// drive real stream traffic in a unit test.
func TestLibp2pMetrics_RecordStreamUpdatesPeerBytes(t *testing.T) {
	alice := makePeer(t, akey)
	bob := makePeer(t, bkey)

	m := NewLibp2pMetrics()
	m.SetHost(alice.Host)
	alice.Network().Notify(m)

	ctx := context.Background()
	require.NoError(t, alice.Connect(ctx, bob.AddrInfo()))

	bobID := bob.Host.ID()
	m.LogRecvMessageStream(1024, "/seed/test", bobID)
	m.LogSentMessageStream(512, "/seed/test", bobID)

	rows := m.PeerBytesSnapshot(10)
	require.Len(t, rows, 1)
	require.Equal(t, bobID, rows[0].PeerID)
	require.EqualValues(t, 1024, rows[0].In)
	require.EqualValues(t, 512, rows[0].Out)
	require.True(t, rows[0].Loopback, "loopback peer should be marked")
	require.False(t, rows[0].LastActive.IsZero())

	snap := m.BW.Snapshot()
	require.EqualValues(t, 1024, snap.LoopbackIn)
	require.EqualValues(t, 512, snap.LoopbackOut)
	require.EqualValues(t, 0, snap.RemoteIn)
}

func TestLibp2pMetrics_PeerIsLoopback_FallsBackToConns(t *testing.T) {
	alice := makePeer(t, akey)
	bob := makePeer(t, bkey)

	m := NewLibp2pMetrics()
	m.SetHost(alice.Host)
	// Intentionally don't Notify — exercise the fallback path that inspects
	// live connections.

	ctx := context.Background()
	require.NoError(t, alice.Connect(ctx, bob.AddrInfo()))
	require.True(t, m.PeerIsLoopback(bob.Host.ID()))
}

func TestLibp2pMetrics_BWCounter_UnknownPeerCountsAsRemote(t *testing.T) {
	alice := makePeer(t, akey)

	m := NewLibp2pMetrics()
	m.SetHost(alice.Host)

	// A peer we've never seen — no peerScope entry, no live conns. Should
	// classify as remote and not panic.
	pid, err := peer.Decode("12D3KooWKqHXKt8R6h6jWAUmJVkjPamxgGqLoYeBgnaprDvjBeBp")
	require.NoError(t, err)

	m.LogRecvMessageStream(100, "/x/y", pid)
	snap := m.BW.Snapshot()
	require.EqualValues(t, 100, snap.RemoteIn)
	require.EqualValues(t, 0, snap.LoopbackIn)
}

