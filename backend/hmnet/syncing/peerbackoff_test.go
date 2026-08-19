package syncing

import (
	"fmt"
	"testing"
	"time"

	"seed/backend/blob"

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
//
// Asserted on the ceiling, not on the wait actually served. Full jitter draws
// uniformly from [0, ceiling), so a 7th failure routinely draws a shorter wait
// than the 1st — comparing two drawn values is a ~2.5% flake, which is exactly
// how this test failed before.
func TestPeerBackoffGrowsWithFailures(t *testing.T) {
	require.Equal(t, backoffBase, backoffCeiling(1))
	require.Equal(t, 2*backoffBase, backoffCeiling(2))
	require.Equal(t, 4*backoffBase, backoffCeiling(3))

	for n := 2; n < 6; n++ {
		require.Greater(t, backoffCeiling(n), backoffCeiling(n-1),
			"a peer that keeps failing must wait longer than a flaky one")
	}

	require.Equal(t, backoffMax, backoffCeiling(99), "the ladder must cap")
	require.Equal(t, backoffMax, backoffCeiling(1<<20), "and not overflow past the cap")
}

// TestPeerBackoffRecordsFailuresWithinBounds covers what Fail actually stores:
// the count climbs, and whatever jitter lands stays inside the ceiling.
func TestPeerBackoffRecordsFailuresWithinBounds(t *testing.T) {
	b := newPeerBackoff()
	p := testPeer(1)

	for range 7 {
		b.Fail(p)
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	require.Equal(t, 7, b.state[p].failures)
	require.LessOrEqual(t, time.Until(b.state[p].until), backoffBase+backoffCeiling(7))
	require.Greater(t, time.Until(b.state[p].until), time.Duration(0))
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

// TestSampleWidthNeverStrandsANode is the regression guard for the bug that
// turned CI red: narrowing to zero without an authority to ask instead leaves an
// empty peer set, and the node silently stops syncing. Production hides it
// because bootstrap guarantees gateways; two daemons paired directly do not.
func TestSampleWidthNeverStrandsANode(t *testing.T) {
	for _, tt := range []struct {
		name                            string
		haveLocally, hasSite, hasGwyway bool
		want                            int
	}{
		{"nothing known, nothing held", false, false, false, maxSampledPeers},
		{"missing, host known", false, true, false, narrowSampledPeers},
		{"missing, only gateways", false, false, true, maxSampledPeers},
		{"held, host known", true, true, false, 0},
		{"held, only gateways", true, false, true, 0},
		{"held, but NOBODY to ask", true, false, false, maxSampledPeers},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := sampleWidth(tt.haveLocally, tt.hasSite, tt.hasGwyway)
			require.Equal(t, tt.want, got)
			if got == 0 {
				require.True(t, tt.hasSite || tt.hasGwyway,
					"a zero sample is only safe when somebody authoritative can answer")
			}
		})
	}
}

// TestScopeQuietTracking covers the signal that replaces "does this resolve as
// a document". An account that only ever published a Profile and some
// Capabilities has no Ref, so it never resolves, and the resolve check alone
// left every such space searching 20 peers every ~11s forever.
func TestScopeQuietTracking(t *testing.T) {
	const scope = blob.IRI("hm://z6MkExample")
	s := &Service{}

	require.False(t, s.scopeIsQuiet(scope), "unknown scopes must search")

	s.recordWaveYield(scope, true, 0)
	require.False(t, s.scopeIsQuiet(scope),
		"one empty wave is not enough — a dropped peer must not narrow a catch-up")

	s.recordWaveYield(scope, true, 0)
	require.True(t, s.scopeIsQuiet(scope), "consistently empty means settled")

	// Anything arriving puts the full search back immediately.
	s.recordWaveYield(scope, true, 3)
	require.False(t, s.scopeIsQuiet(scope))
}

// TestScopeQuietIgnoresOneShots: a non-recursive discovery never runs a second
// wave, so recording it only grows the map.
func TestScopeQuietIgnoresOneShots(t *testing.T) {
	const scope = blob.IRI("hm://z6MkOneShot")
	s := &Service{}

	s.recordWaveYield(scope, false, 0)
	s.recordWaveYield(scope, false, 0)

	require.False(t, s.scopeIsQuiet(scope))
	require.Empty(t, s.quiet)
}

// TestScopeQuietRespectsCap keeps the tracker bounded.
func TestScopeQuietRespectsCap(t *testing.T) {
	s := &Service{}
	for i := range maxQuietScopes + 50 {
		s.recordWaveYield(blob.IRI(fmt.Sprintf("hm://scope%d", i)), true, 0)
	}
	require.Len(t, s.quiet, maxQuietScopes)
}

// TestScopeQuietAnyShapeYieldResets: only recursive waves accumulate quiet, but
// ANY wave shape that downloads blobs for the IRI proves the scope is not
// settled. Before the fix a one-shot's yield was ignored while scopeIsQuiet was
// consulted for every shape — a narrowed subscription could stay narrowed
// through direct evidence of new content.
func TestScopeQuietAnyShapeYieldResets(t *testing.T) {
	const scope = blob.IRI("hm://z6MkYield")
	s := &Service{}

	s.recordWaveYield(scope, true, 0)
	s.recordWaveYield(scope, true, 0)
	require.True(t, s.scopeIsQuiet(scope))

	s.recordWaveYield(scope, false, 3)
	require.False(t, s.scopeIsQuiet(scope),
		"a non-recursive wave that fetched blobs must un-quiet the scope")
}

// TestExhaustiveWaveSeedsQuietly: a fresh recursive scope's first waves are
// naturally full-width (nothing has narrowed yet), so the first
// shouldRunExhaustive call only seeds the clock instead of double-probing.
func TestExhaustiveWaveSeedsQuietly(t *testing.T) {
	const scope = blob.IRI("hm://z6MkSeed")
	s := &Service{}
	now := time.Now()

	require.Empty(t, s.shouldRunExhaustive(scope, true, now))
	require.Contains(t, s.lastExhaustive, scope, "first call must arm the periodic clock")
}

// TestExhaustiveWavePeriodicFires: once the interval elapses the scope earns
// exactly one exhaustive wave, and the clock re-arms.
func TestExhaustiveWavePeriodicFires(t *testing.T) {
	const scope = blob.IRI("hm://z6MkPeriodic")
	s := &Service{}
	now := time.Now()

	require.Empty(t, s.shouldRunExhaustive(scope, true, now))
	s.lastExhaustive[scope] = now.Add(-defaultExhaustiveWaveInterval - time.Second)

	require.Equal(t, "periodic", s.shouldRunExhaustive(scope, true, now))
	require.Empty(t, s.shouldRunExhaustive(scope, true, now),
		"the probe must consume the interval, not fire on every wave")
}

// TestExhaustiveWaveHonorsConfiguredInterval: the config knob must actually
// drive the cadence (the e2e tests shrink it to seconds).
func TestExhaustiveWaveHonorsConfiguredInterval(t *testing.T) {
	const scope = blob.IRI("hm://z6MkTuned")
	s := &Service{exhaustiveEvery: time.Minute}
	now := time.Now()

	require.Empty(t, s.shouldRunExhaustive(scope, true, now))
	s.lastExhaustive[scope] = now.Add(-2 * time.Minute)
	require.Equal(t, "periodic", s.shouldRunExhaustive(scope, true, now))
}

// TestExhaustiveIgnoresOneShots: a non-recursive discovery never runs a second
// wave, so the periodic probe has nothing to inform there.
func TestExhaustiveIgnoresOneShots(t *testing.T) {
	const scope = blob.IRI("hm://z6MkOnce")
	s := &Service{}
	now := time.Now()

	require.Empty(t, s.shouldRunExhaustive(scope, false, now))
	require.Empty(t, s.lastExhaustive)

	// But a forced probe fires regardless of shape: user interest may arrive
	// as a one-shot hot task.
	s.noteUserInterest(scope, now)
	require.Equal(t, "forced", s.shouldRunExhaustive(scope, false, now))
}

// TestUserInterestForcesOnceAndRateLimits: one touch arms exactly one probe,
// and re-touching inside the rate window must not re-arm — the hot-task
// heartbeat calls this every few seconds while a view is open.
func TestUserInterestForcesOnceAndRateLimits(t *testing.T) {
	const scope = blob.IRI("hm://z6MkForced")
	s := &Service{}
	now := time.Now()

	s.noteUserInterest(scope, now)
	require.Equal(t, "forced", s.shouldRunExhaustive(scope, true, now))
	require.Empty(t, s.shouldRunExhaustive(scope, true, now), "the forced bit is consumed by one wave")

	s.noteUserInterest(scope, now.Add(userProbeMinInterval/2))
	require.Empty(t, s.shouldRunExhaustive(scope, true, now.Add(userProbeMinInterval/2)),
		"a touch inside the rate window must not re-arm")

	s.noteUserInterest(scope, now.Add(userProbeMinInterval+time.Second))
	require.Equal(t, "forced", s.shouldRunExhaustive(scope, true, now.Add(userProbeMinInterval+time.Second)))
}

// TestExhaustiveRespectsCap keeps both probe maps bounded, mirroring the quiet
// tracker's cap.
func TestExhaustiveRespectsCap(t *testing.T) {
	s := &Service{}
	now := time.Now()
	for i := range maxQuietScopes + 50 {
		s.shouldRunExhaustive(blob.IRI(fmt.Sprintf("hm://p%d", i)), true, now)
		s.noteUserInterest(blob.IRI(fmt.Sprintf("hm://f%d", i)), now)
	}
	require.LessOrEqual(t, len(s.lastExhaustive), maxQuietScopes)
	require.LessOrEqual(t, len(s.forcedExhaustive), maxQuietScopes)
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

// TestMediaSlotRefusesRatherThanQueues: past the cap the next sync must be
// turned away, not blocked, since queueing would hold the worker slot the cap
// exists to protect.
func TestMediaSlotRefusesRatherThanQueues(t *testing.T) {
	s := newTrySem(mediaSlots)

	for i := range mediaSlots {
		require.True(t, s.tryAcquire(), "slot %d must be available", i)
	}
	require.False(t, s.tryAcquire(), "past the cap a holder must be refused, not blocked")

	s.release()
	require.True(t, s.tryAcquire(), "releasing lets the next sync through")
}

// TestMediaSlotsLeaveRoomForStructural: the whole point of the cap is that bulk
// media cannot occupy every worker while other spaces still need their Refs and
// Changes — nor compete for bandwidth with a fetch a user is waiting on. Raising
// this to 2 improved background convergence and made page load slower, so it
// stays small until the cap is made conditional on interactive work instead.
func TestMediaSlotsLeaveRoomForStructural(t *testing.T) {
	require.Less(t, mediaSlots, 6, "must leave workers free at the default MaxWorkers=6")
	require.Positive(t, mediaSlots)
}
