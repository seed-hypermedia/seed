package syncperf

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestSpaceSessionsAreIndependent: two spaces syncing at once must each get
// their own busy time, not a share of a single global figure.
func TestSpaceSessionsAreIndependent(t *testing.T) {
	tr := NewTracker(time.Now())

	endA := tr.SessionStart("spaceA")
	time.Sleep(60 * time.Millisecond)
	endA()

	endB := tr.SessionStart("spaceB")
	time.Sleep(30 * time.Millisecond)
	endB()

	spaces := tr.SpaceStats()
	a, b := spaces["spaceA"], spaces["spaceB"]

	require.EqualValues(t, 1, a.Sessions)
	require.EqualValues(t, 1, b.Sessions)
	approx(t, 0.060, a.BusyTime.Seconds(), 0.030, "spaceA busy time")
	approx(t, 0.030, b.BusyTime.Seconds(), 0.030, "spaceB busy time")
	require.Greater(t, a.BusyTime, b.BusyTime, "the longer session must show more busy time")
}

// TestSpaceSessionUnionNotSum: overlapping sessions for the SAME space cover
// their shared wall time once in BusyTime, while SumSessionTime counts both —
// the same distinction the global tracker makes.
func TestSpaceSessionUnionNotSum(t *testing.T) {
	tr := NewTracker(time.Now())

	e1 := tr.SessionStart("spaceA")
	e2 := tr.SessionStart("spaceA")
	time.Sleep(80 * time.Millisecond)
	e1()
	e2()

	a := tr.SpaceStats()["spaceA"]
	require.EqualValues(t, 2, a.Sessions)
	approx(t, 0.080, a.BusyTime.Seconds(), 0.040, "busy is the union")
	approx(t, 0.160, a.SumSessionTime.Seconds(), 0.080, "session time is the sum")
	approx(t, 2.0, a.AvgConcurrency(), 0.5, "two fully overlapping sessions")
}

// TestSpaceStatsIncludeOpenSession guards the mid-flight read, same as the
// global snapshot: a page loaded while a space is syncing must not report zero.
func TestSpaceStatsIncludeOpenSession(t *testing.T) {
	tr := NewTracker(time.Now())

	end := tr.SessionStart("spaceA")
	defer end()
	time.Sleep(40 * time.Millisecond)

	a := tr.SpaceStats()["spaceA"]
	require.Equal(t, 1, a.ActiveSessions)
	require.EqualValues(t, 0, a.Sessions, "not finished yet")
	require.Positive(t, a.BusyTime, "an open session must count as busy")
}

// TestSpaceStagesSumToUptime is the invariant the page relies on: a space's four
// stage figures partition the wall clock exactly, just like the global ones.
func TestSpaceStagesSumToUptime(t *testing.T) {
	tr := NewTracker(time.Now())

	leave := tr.EnterStage(StageExchange, "spaceA")
	time.Sleep(50 * time.Millisecond)
	leave()
	time.Sleep(20 * time.Millisecond)

	a := tr.SpaceStats()["spaceA"]
	sum := a.WeightedIdle + a.WeightedConnecting + a.WeightedExchange + a.WeightedTransfer
	approx(t, a.Uptime.Seconds(), sum.Seconds(), 0.005, "stage figures must partition uptime")
	require.Positive(t, a.WeightedExchange)
	require.Positive(t, a.WeightedIdle, "time before and after the stage is idle for this space")
}

// TestSpaceStagesWeightByOccupancy: with two units connecting and one
// transferring, the elapsed slice splits 2:1 — the same occupancy weighting the
// global partition uses, applied per space.
func TestSpaceStagesWeightByOccupancy(t *testing.T) {
	tr := NewTracker(time.Now())

	c1 := tr.EnterStage(StageConnecting, "spaceA")
	c2 := tr.EnterStage(StageConnecting, "spaceA")
	tr1 := tr.EnterStage(StageTransfer, "spaceA")
	time.Sleep(90 * time.Millisecond)
	c1()
	c2()
	tr1()

	a := tr.SpaceStats()["spaceA"]
	ratio := a.WeightedConnecting.Seconds() / a.WeightedTransfer.Seconds()
	approx(t, 2.0, ratio, 0.4, "two connecting to one transferring is a 2:1 split")
}

// TestSpaceStagesAreIndependent: work on one space must not appear under
// another. This is the whole point of the per-space split.
func TestSpaceStagesAreIndependent(t *testing.T) {
	tr := NewTracker(time.Now())

	leave := tr.EnterStage(StageTransfer, "spaceA")
	time.Sleep(50 * time.Millisecond)
	leave()

	spaces := tr.SpaceStats()
	require.Positive(t, spaces["spaceA"].WeightedTransfer)
	_, hasB := spaces["spaceB"]
	require.False(t, hasB, "a space that never synced must not appear at all")
}

// TestSpaceEmptyNameGoesToUnattributed: a session or stage with no resolvable
// space still has to be counted somewhere.
func TestSpaceEmptyNameGoesToUnattributed(t *testing.T) {
	tr := NewTracker(time.Now())

	end := tr.SessionStart("")
	time.Sleep(20 * time.Millisecond)
	end()

	spaces := tr.SpaceStats()
	require.Contains(t, spaces, UnattributedSpace)
	require.EqualValues(t, 1, spaces[UnattributedSpace].Sessions)
}

// TestGlobalStatsMatchTracker: the parent row and the children come from the
// same shape, so GlobalStats must agree with the underlying snapshots rather
// than being computed a second, divergent way.
func TestGlobalStatsMatchTracker(t *testing.T) {
	tr := NewTracker(time.Now())

	end := tr.SessionStart("spaceA")
	leave := tr.EnterStage(StageTransfer, "spaceA")
	time.Sleep(40 * time.Millisecond)
	leave()
	end()

	g := tr.GlobalStats()
	s := tr.Snapshot()
	st := tr.Stages()

	require.Equal(t, s.Sessions, g.Sessions)
	require.Equal(t, s.ActiveSessions, g.ActiveSessions)
	approx(t, s.BusyTime.Seconds(), g.BusyTime.Seconds(), 0.020, "busy time")
	approx(t, st.WeightedTransfer.Seconds(), g.WeightedTransfer.Seconds(), 0.020, "transfer")
	approx(t, st.Transfer.Seconds(), g.AnyTransfer.Seconds(), 0.020, "any-transfer occupancy")
}

// TestSpaceLeaveStageIsIdempotent: EnterStage's leave func is deferred on paths
// that also call it explicitly, so a double call must not drive occupancy
// negative and corrupt every later measurement.
func TestSpaceLeaveStageIsIdempotent(t *testing.T) {
	tr := NewTracker(time.Now())

	leave := tr.EnterStage(StageTransfer, "spaceA")
	time.Sleep(20 * time.Millisecond)
	leave()
	leave()
	leave()
	time.Sleep(20 * time.Millisecond)

	tr.stmu.Lock()
	occ := tr.spaceStates["spaceA"].occ[StageTransfer]
	tr.stmu.Unlock()
	require.Zero(t, occ, "occupancy must not go negative")

	a := tr.SpaceStats()["spaceA"]
	require.Positive(t, a.WeightedIdle, "the space is idle again after leaving")
}
