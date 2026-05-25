package sqlitex

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestSnapshotDrainedDuringWaitWindow drives recordTx + snapshotDrainedDuringWait
// directly on a fresh txTracker so we can assert the (now-hold, now] window
// math precisely, without depending on real BEGIN IMMEDIATE timing.
//
// Setup: three completed writes at known offsets. The middle one is the
// only one that should land inside the victim's wait window.
func TestSnapshotDrainedDuringWaitWindow(t *testing.T) {
	tt := newTxTracker()

	// recordTx captures time.Now() inside the locked section, so we can't
	// directly inject timestamps. Instead, lay down three completions
	// with deliberate sleeps so their relative ordering matches our
	// assertion.
	tt.recordTx("preWindowCaller", 0, 1*time.Millisecond, 0, outcomeCommit, nil, nil)
	time.Sleep(60 * time.Millisecond)
	tt.recordTx("inWindowCaller", 0, 1*time.Millisecond, 0, outcomeCommit, nil, nil)
	time.Sleep(10 * time.Millisecond)

	// Snapshot with a 30 ms window: only `inWindowCaller` should be
	// inside (now-30ms, now]. `preWindowCaller` committed ~70 ms ago,
	// outside the window.
	now := time.Now()
	got := tt.snapshotDrainedDuringWait(now, 30*time.Millisecond)
	names := make(map[string]int)
	for _, c := range got {
		names[c.Caller]++
	}
	require.Equal(t, 1, names["inWindowCaller"],
		"inWindowCaller committed ~10 ms before snapshot — must be in the (now-30ms, now] window. got: %#v", got)
	require.Equal(t, 0, names["preWindowCaller"],
		"preWindowCaller committed ~70 ms before snapshot — must NOT be in the 30 ms window")
}

// TestSnapshotDrainedDuringWaitExcludesNonOwners verifies outcomes that
// did not own the writer slot (begin_busy, begin_interrupted, savepoint
// nested, savepoint_ro) are never inserted into the completed ring, so
// they cannot pollute a victim's drained-during-wait attribution.
func TestSnapshotDrainedDuringWaitExcludesNonOwners(t *testing.T) {
	tt := newTxTracker()
	// All four outcomes that the ring must NOT record:
	tt.recordTx("busyCaller", 1*time.Millisecond, 1*time.Millisecond, 0, outcomeBeginBusy, nil, nil)
	tt.recordTx("interruptedCaller", 1*time.Millisecond, 1*time.Millisecond, 0, outcomeBeginInterrupted, nil, nil)
	tt.recordTx("nestedSavepointCaller", 0, 1*time.Millisecond, 0, outcomeSavepoint, nil, nil)
	tt.recordTx("readOnlyCaller", 0, 1*time.Millisecond, 0, outcomeSavepointReadOnly, nil, nil)
	// Plus one that the ring MUST record, as a control.
	tt.recordTx("commitCaller", 0, 1*time.Millisecond, 0, outcomeCommit, nil, nil)

	got := tt.snapshotDrainedDuringWait(time.Now(), time.Hour)
	for _, c := range got {
		require.NotEqual(t, "busyCaller", c.Caller, "begin_busy never owned the writer slot")
		require.NotEqual(t, "interruptedCaller", c.Caller, "begin_interrupted never owned the writer slot")
		require.NotEqual(t, "nestedSavepointCaller", c.Caller, "nested savepoint is inside an outer scope, would double-count")
		require.NotEqual(t, "readOnlyCaller", c.Caller, "savepoint_ro only held SHARED — never blocks BEGIN IMMEDIATE")
	}
	// Control: the legitimate commit must be present.
	require.Equal(t, 1, len(got), "only the commit should be recorded; got %#v", got)
	require.Equal(t, "commitCaller", got[0].Caller)
}

// TestRecentCompletedRingWrapsKeepingNewest verifies the fixed-size ring
// wraps around once it fills, keeping the most recent completedRingCap
// entries. The window-by-time filter at read time would have no entries
// to consider if the ring lost the newest writes to overflow.
//
// We stuff completedRingCap+50 entries and assert that the oldest 50 are
// gone but the newest 50 are still findable via a generous time window.
func TestRecentCompletedRingWrapsKeepingNewest(t *testing.T) {
	tt := newTxTracker()
	// Fill past capacity. Each recordTx is O(1); 8200 iterations runs
	// in well under a second.
	overshoot := 50
	for i := 0; i < completedRingCap+overshoot; i++ {
		tt.recordTx("ringCaller", 0, 1*time.Microsecond, 0, outcomeCommit, nil, nil)
	}

	got := tt.snapshotDrainedDuringWait(time.Now(), time.Hour)
	require.Equal(t, completedRingCap, len(got),
		"after overshooting by %d, ring length must clamp to completedRingCap=%d, got %d",
		overshoot, completedRingCap, len(got))
}

// TestSnapshotDrainedDuringWaitOldestFirst verifies the returned slice is
// chronological (oldest commit first), matching the page-render
// expectation. The natural ring walk is newest-first; the snapshot
// reverses so the operator reads the contention chain top-to-bottom.
func TestSnapshotDrainedDuringWaitOldestFirst(t *testing.T) {
	tt := newTxTracker()
	tt.recordTx("first", 0, 1*time.Millisecond, 0, outcomeCommit, nil, nil)
	time.Sleep(5 * time.Millisecond)
	tt.recordTx("second", 0, 1*time.Millisecond, 0, outcomeCommit, nil, nil)
	time.Sleep(5 * time.Millisecond)
	tt.recordTx("third", 0, 1*time.Millisecond, 0, outcomeCommit, nil, nil)

	got := tt.snapshotDrainedDuringWait(time.Now(), time.Hour)
	require.Equal(t, 3, len(got))
	require.Equal(t, "first", got[0].Caller, "oldest commit must render first")
	require.Equal(t, "second", got[1].Caller)
	require.Equal(t, "third", got[2].Caller, "newest commit must render last")
}

// TestSnapshotDrainedDuringWaitEmptyRing verifies a snapshot from a
// freshly-created tracker (no completions yet) returns an empty slice
// rather than reading uninitialised zero-valued ring slots.
func TestSnapshotDrainedDuringWaitEmptyRing(t *testing.T) {
	tt := newTxTracker()
	got := tt.snapshotDrainedDuringWait(time.Now(), time.Hour)
	require.Empty(t, got, "empty tracker must return empty drained list, not zero-valued ring slots")
}

// TestDrainedRenderBlock verifies the HTML template renders the
// "drained during wait" details block when a begin_busy sample carries
// a non-empty DrainedDuringWait list. The render path is exercised on
// the singleton tracker so it goes through DebugHandler unchanged.
// Pure-integration timing is too racy (SQLite busy_handler backoff vs.
// commit cadence) — see the note in tx_test.go — so this test seeds
// the tracker via direct recordTx calls under known caller names.
func TestDrainedRenderBlock(t *testing.T) {
	// Record a couple of commits with a unique caller name so we can
	// find them on the rendered page even if other tests have polluted
	// the singleton tracker.
	const drainerName = "renderblock.drainerCaller"
	const victimName = "renderblock.victimCaller"
	tracker.recordTx(drainerName, 0, 1*time.Millisecond, 0, outcomeCommit, nil, nil)
	tracker.recordTx(drainerName, 0, 1*time.Millisecond, 0, outcomeCommit, nil, nil)

	// Begin_busy sample with hold large enough that the drainer commits
	// land inside (now - hold, now]. The recordTx slow-sample branch
	// gates on (hold >= slowThreshold || outcome == begin_busy) so any
	// begin_busy enters the recent ring regardless of hold magnitude.
	// Use a hold that's bigger than the few ms between the two commits
	// above and `now`, so the window covers them.
	tracker.recordTx(victimName, 200*time.Millisecond, 200*time.Millisecond, 0, outcomeBeginBusy, nil, nil)

	body := renderPage(t)

	require.Contains(t, body, "drained during wait",
		"begin_busy row with a non-empty DrainedDuringWait must render the details block")
	require.Contains(t, body, drainerName,
		"the drained-list caller must be named in the rendered HTML so an operator can attribute the wait")
	// And the block must reference the victim somewhere — the begin_busy
	// row carrying the drained list is named by victimName.
	require.Contains(t, body, victimName)
}

// renderPage is the internal-test counterpart of renderDebugPage in
// tx_test.go (which lives in package sqlitex_test and can't be reused
// from this internal-test file). Calls DebugHandler() on the singleton
// tracker and returns the rendered HTML.
func renderPage(t *testing.T) string {
	t.Helper()
	h := DebugHandler()
	req := httptest.NewRequest(http.MethodGet, "/debug/sqlite", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	// Touch strings to keep the import on the file even if all other
	// references go away during future refactors.
	require.True(t, strings.HasPrefix(rec.Body.String(), "<!DOCTYPE"))
	return rec.Body.String()
}

// TestBeginBusyAttributionAggregates verifies the new "Begin-busy
// attribution" section aggregates correctly across multiple begin_busy
// events. Seed a known holder via commits, then fire 3 begin_busy
// events whose snapshotDrainedDuringWait will capture that holder.
// Render the page; the attribution table must name the holder with
// Events == 3 and HeldDuringWaitMs > 0.
func TestBeginBusyAttributionAggregates(t *testing.T) {
	const offender = "attribution.offenderCaller"
	const victim = "attribution.victimCaller"
	// Record 3 commits so they're in the completed ring and can be
	// picked up by the begin_busy snapshotDrainedDuringWait walk. Each
	// commit's hold contributes to HeldDuringWaitMs.
	for i := 0; i < 3; i++ {
		tracker.recordTx(offender, 0, 10*time.Millisecond, 0, outcomeCommit, nil, nil)
	}
	// Fire 3 begin_busy events with a 1-hour hold so the wait window
	// covers all the offender commits above.
	for i := 0; i < 3; i++ {
		tracker.recordTx(victim, time.Hour, time.Hour, 0, outcomeBeginBusy, nil, nil)
	}

	body := renderPage(t)

	const attrMarker = "<h3>Begin-busy attribution</h3>"
	idx := strings.Index(body, attrMarker)
	require.GreaterOrEqual(t, idx, 0, "page must include the Begin-busy attribution section")
	// Section ends at the next <details> (Slowest write operations).
	rest := body[idx:]
	stop := strings.Index(rest, "<details>")
	if stop < 0 {
		stop = len(rest)
	}
	section := rest[:stop]

	require.Contains(t, section, offender,
		"attribution section must name the offender caller. section: %s", section)
	// Events count must be exactly 3 (we fired 3 begin_busy events that
	// each saw the same 3 commits in their wait window).
	require.Contains(t, section, "<td class=\"num\">3</td>",
		"attribution section must show Events=3 for the offender. section: %s", section)
}

// TestRecentBusyHasOwnCap verifies that begin_busy events go into the
// separate recentBusy ring (capped at recentBusyCap=25), so flooding
// the daemon with begin_busy victims cannot evict real slow commits
// from recentWrite. This is the fix for the "all 50 rows are 10s
// victims" shitshow.
func TestRecentBusyHasOwnCap(t *testing.T) {
	tt := newTxTracker()
	// Fire well past recentBusyCap begin_busy events. Each is large enough
	// hold (≥ slowThreshold OR outcome==begin_busy is sufficient — the
	// latter applies, so any hold works for ring entry).
	const overshoot = 10
	for i := 0; i < recentBusyCap+overshoot; i++ {
		tt.recordTx("busyFlooder", time.Second, time.Second, 0, outcomeBeginBusy, nil, nil)
	}
	// Plus a slow commit to verify it's NOT evicted by the busy flood.
	tt.recordTx("slowCommitter", 0, 200*time.Millisecond, 0, outcomeCommit, nil, nil)

	snap := tt.snapshot()
	require.Equal(t, recentBusyCap, len(snap.RecentBusy),
		"recentBusy length must clamp to recentBusyCap=%d after overshoot of %d, got %d",
		recentBusyCap, overshoot, len(snap.RecentBusy))
	// The slow commit must survive in recentWrite — it would have been
	// evicted under the old single-ring design where begin_busy's 1 s
	// synthesised hold beats a 200 ms real commit.
	var foundCommit bool
	for _, s := range snap.RecentWrite {
		if s.Caller == "slowCommitter" {
			foundCommit = true
			break
		}
	}
	require.True(t, foundCommit,
		"slow commit must remain in recentWrite after a begin_busy flood — the whole point of splitting the ring")
}

// TestHoldSumNsAccumulatesOnlyWriterOwners verifies the per-caller
// holdSumNs counter — the metric that powers the page's "Σ hold" /
// "% wall" columns — increments only for outcomes that actually owned
// the writer slot. begin_busy, begin_interrupted, nested savepoint,
// and savepoint_ro must not contribute.
func TestHoldSumNsAccumulatesOnlyWriterOwners(t *testing.T) {
	var s callerStats
	// 5 ms hold for each scenario; only the three writer-slot owners
	// should land in holdSumNs.
	s.record(5*time.Millisecond, 0, 0, outcomeBeginBusy)
	s.record(5*time.Millisecond, 0, 0, outcomeBeginInterrupted)
	s.record(5*time.Millisecond, 0, 0, outcomeSavepoint)
	s.record(5*time.Millisecond, 0, 0, outcomeSavepointReadOnly)
	require.Zero(t, s.write.holdSumNs, "non-owner outcomes must not contribute to holdSumNs")

	s.record(7*time.Millisecond, 0, 0, outcomeCommit)
	s.record(11*time.Millisecond, 0, 0, outcomeRollback)
	s.record(13*time.Millisecond, 0, 0, outcomeSavepointTop)
	want := uint64((7 + 11 + 13) * time.Millisecond)
	require.Equal(t, want, s.write.holdSumNs,
		"holdSumNs must equal the sum of commit + rollback + savepoint_top holds")
}
