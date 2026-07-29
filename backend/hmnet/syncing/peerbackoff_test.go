package syncing

import (
	"fmt"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/require"
)

func testPeer(n int) peer.ID { return peer.ID(fmt.Sprintf("peer-%d", n)) }

func TestPeerBackoffBenchesAfterFailure(t *testing.T) {
	b := newPeerBackoff()
	p := testPeer(1)

	require.True(t, b.Eligible(p), "an unknown peer is eligible")

	b.Fail(p)
	require.False(t, b.Eligible(p), "a failed peer sits out")
	require.Equal(t, 1, b.Benched())
}

// TestPeerBackoffSuccessClears is the property that keeps an intermittently
// reachable peer usable: one success wipes the ladder.
func TestPeerBackoffSuccessClears(t *testing.T) {
	b := newPeerBackoff()
	p := testPeer(1)

	b.Fail(p)
	b.Fail(p)
	b.Succeed(p)

	require.True(t, b.Eligible(p))
	require.Zero(t, b.Benched())
}

// TestPeerBackoffGrowsWithFailures: repeated failures must lengthen the bench
// time, otherwise a permanently dead peer is retried as often as a flaky one.
func TestPeerBackoffGrowsWithFailures(t *testing.T) {
	b := newPeerBackoff()
	p := testPeer(1)

	b.Fail(p)
	b.mu.Lock()
	first := b.state[p].until
	b.mu.Unlock()

	for range 6 {
		b.Fail(p)
	}
	b.mu.Lock()
	later := b.state[p].until
	failures := b.state[p].failures
	b.mu.Unlock()

	require.Equal(t, 7, failures)
	require.True(t, later.After(first), "backoff must extend with repeated failures")
	require.LessOrEqual(t, time.Until(later), backoffBase+backoffMax,
		"backoff must stay capped")
}

// TestPeerBackoffExpiryRestoresEligibility: when the timer runs out the peer
// rejoins the pool on equal footing — that rotation is what replaces a
// reputation score.
func TestPeerBackoffExpiryRestoresEligibility(t *testing.T) {
	b := newPeerBackoff()
	p := testPeer(1)

	b.Fail(p)
	b.mu.Lock()
	b.state[p].until = time.Now().Add(-time.Second)
	b.mu.Unlock()

	require.True(t, b.Eligible(p), "expired backoff makes the peer eligible again")
	require.Zero(t, b.Benched(), "and the entry is forgotten, so it starts clean")
}

// TestSamplePeersRespectsCeiling is the whole point of the change: the fan-out
// used to be uncapped, which is what produced 77k dials for 577 transfers.
func TestSamplePeersRespectsCeiling(t *testing.T) {
	pool := make([]peer.ID, 500)
	for i := range pool {
		pool[i] = testPeer(i)
	}

	got := samplePeers(nil, pool, 20, nil)
	require.Len(t, got, 20)
	require.Subset(t, pool, got)
}

// TestSamplePeersAlwaysIncludesAuthoritative: siteUrl servers hold the data, so
// they must never be sampled out, and they don't consume sample budget.
func TestSamplePeersAlwaysIncludesAuthoritative(t *testing.T) {
	always := []peer.ID{testPeer(900), testPeer(901)}
	pool := make([]peer.ID, 100)
	for i := range pool {
		pool[i] = testPeer(i)
	}

	got := samplePeers(always, pool, 5, nil)
	require.Len(t, got, 7, "always-include peers are additional to the sample")
	require.Subset(t, got, always)
}

// TestSamplePeersNarrowKeepsAuthoritative pins the steady-state shape: once a
// scope resolves to a site server, the speculative sample drops but the
// authoritative peers are all still there. Getting this backwards — narrowing
// the always-set instead of the sample — is what makes a page render blank.
func TestSamplePeersNarrowKeepsAuthoritative(t *testing.T) {
	always := []peer.ID{testPeer(900), testPeer(901), testPeer(902)}
	pool := make([]peer.ID, 200)
	for i := range pool {
		pool[i] = testPeer(i)
	}

	got := samplePeers(always, pool, 2, nil)
	require.Len(t, got, 5, "3 authoritative + 2 sampled")
	require.Subset(t, got, always)

	// Liveness mode: no speculative search at all, but the authoritative peers
	// must survive. A zero limit that also dropped `always` would mean a settled
	// document silently stops receiving updates.
	got = samplePeers(always, pool, 0, nil)
	require.Equal(t, always, got, "a zero sample must still ask the authoritative peers")
}

// TestSamplePeersSkipsIneligible: benched peers must not be drawn, or backoff
// accomplishes nothing.
func TestSamplePeersSkipsIneligible(t *testing.T) {
	pool := []peer.ID{testPeer(1), testPeer(2), testPeer(3)}
	blocked := testPeer(2)

	got := samplePeers(nil, pool, 10, func(p peer.ID) bool { return p != blocked })
	require.Len(t, got, 2)
	require.NotContains(t, got, blocked)
}

// TestSamplePeersFailsOpen: if backoff has benched everything, the
// authoritative peers still go out. Going silent would be worse than retrying
// a peer early.
func TestSamplePeersFailsOpen(t *testing.T) {
	always := []peer.ID{testPeer(900)}
	pool := []peer.ID{testPeer(1), testPeer(2)}

	got := samplePeers(always, pool, 10, func(peer.ID) bool { return false })
	require.Equal(t, always, got)
}

// TestSamplePeersDeduplicates: a peer present in both sets must be dialed once.
func TestSamplePeersDeduplicates(t *testing.T) {
	shared := testPeer(1)
	got := samplePeers([]peer.ID{shared}, []peer.ID{shared, testPeer(2)}, 10, nil)
	require.Len(t, got, 2)
}

// TestSamplePeersRotates guards the behaviour that replaces the old
// `ORDER BY updated_at DESC`, which re-picked the same peers every round and so
// never let a failing-but-recently-active peer rotate out.
func TestSamplePeersRotates(t *testing.T) {
	pool := make([]peer.ID, 200)
	for i := range pool {
		pool[i] = testPeer(i)
	}

	seen := make(map[peer.ID]struct{})
	for range 10 {
		for _, p := range samplePeers(nil, pool, 20, nil) {
			seen[p] = struct{}{}
		}
	}
	require.Greater(t, len(seen), 20,
		"repeated waves must reach beyond a single fixed subset")
}

// TestMediaSlotIsExclusive: the second concurrent sync must be turned away
// rather than queued, since queueing would hold the worker slot this cap exists
// to protect.
func TestMediaSlotIsExclusive(t *testing.T) {
	s := newTrySem(1)

	require.True(t, s.tryAcquire())
	require.False(t, s.tryAcquire(), "a second holder must be refused, not blocked")

	s.release()
	require.True(t, s.tryAcquire(), "releasing lets the next sync through")
}
