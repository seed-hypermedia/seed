package syncperf

import (
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/require"
)

// approx asserts got is within tol of want. Wall-clock tests can't be exact.
func approx(t *testing.T, want, got, tol float64, msg string) {
	t.Helper()
	require.InDelta(t, want, got, tol, msg)
}

func counterValue(t *testing.T, reason string) float64 {
	t.Helper()
	var m dto.Metric
	require.NoError(t, mDelaySkipped.WithLabelValues(reason).Write(&m))
	return m.GetCounter().GetValue()
}

func histogramCount(t *testing.T, vec *prometheus.HistogramVec, blobType string) uint64 {
	t.Helper()
	obs, err := vec.GetMetricWithLabelValues(blobType)
	require.NoError(t, err)
	var m dto.Metric
	require.NoError(t, obs.(prometheus.Metric).Write(&m))
	return m.GetHistogram().GetSampleCount()
}

// TestBurstThenIdle is the scenario the whole design exists for: data arrives
// in a burst, then nothing happens for a long time. Active throughput must
// report the burst speed and wall throughput must report the user's
// experience — they must NOT be the same number.
func TestBurstThenIdle(t *testing.T) {
	tr := NewTracker(time.Now())

	end := tr.SessionStart("spaceA")
	tr.RecordWrite(10, 10<<20) // 10 MiB
	time.Sleep(50 * time.Millisecond)
	end()

	// Idle for 4x as long as the session was busy.
	time.Sleep(200 * time.Millisecond)

	s := tr.Snapshot()
	require.EqualValues(t, 10<<20, s.Bytes)
	require.EqualValues(t, 1, s.Sessions)
	require.Zero(t, s.ActiveSessions)

	// The essential property: busy time is a fraction of uptime, so the two
	// throughputs diverge and duty cycle explains the gap.
	require.Less(t, s.BusyTime, s.Uptime)
	require.Greater(t, s.ActiveThroughput(), s.WallThroughput(),
		"active throughput must exceed wall throughput when the daemon idles between bursts")

	// wall = active * dutyCycle is the identity that makes the two reconcilable.
	approx(t, s.WallThroughput(), s.ActiveThroughput()*s.DutyCycle(), s.WallThroughput()*0.01,
		"wall throughput must equal active throughput times duty cycle")

	// ~50ms busy out of ~250ms uptime.
	require.Less(t, s.DutyCycle(), 0.5)
	require.Greater(t, s.DutyCycle(), 0.0)
}

// TestConcurrentSessionsUnionNotSum is the other half of the design: two
// sessions covering the same wall interval must contribute that interval to
// BusyTime once, while SumSessionTime counts both.
func TestConcurrentSessionsUnionNotSum(t *testing.T) {
	tr := NewTracker(time.Now())

	endA := tr.SessionStart("spaceA")
	endB := tr.SessionStart("spaceA")
	time.Sleep(100 * time.Millisecond)
	endA()
	endB()

	s := tr.Snapshot()
	require.EqualValues(t, 2, s.Sessions)

	// Busy time is the covered interval (~100ms), not the sum (~200ms).
	approx(t, 0.100, s.BusyTime.Seconds(), 0.050, "busy time should be the union of the two intervals")
	approx(t, 0.200, s.SumSessionTime.Seconds(), 0.100, "session time should be the sum of both durations")
	approx(t, 2.0, s.AvgConcurrency(), 0.3, "two fully overlapping sessions average 2x concurrency")
}

// TestSequentialSessionsDoNotOverlap is the control for the test above: when
// sessions don't overlap, busy time and summed session time converge.
func TestSequentialSessionsDoNotOverlap(t *testing.T) {
	tr := NewTracker(time.Now())

	for range 2 {
		end := tr.SessionStart("spaceA")
		time.Sleep(50 * time.Millisecond)
		end()
		time.Sleep(10 * time.Millisecond)
	}

	s := tr.Snapshot()
	approx(t, s.SumSessionTime.Seconds(), s.BusyTime.Seconds(), 0.030,
		"non-overlapping sessions make busy time and summed session time equal")
	approx(t, 1.0, s.AvgConcurrency(), 0.3, "sequential sessions average 1x concurrency")
}

// TestSnapshotIncludesOpenSession guards the mid-burst read: a page loaded
// while a sync is running must report the in-flight interval, not zero.
func TestSnapshotIncludesOpenSession(t *testing.T) {
	tr := NewTracker(time.Now())

	end := tr.SessionStart("spaceA")
	defer end()
	time.Sleep(50 * time.Millisecond)

	s := tr.Snapshot()
	require.Equal(t, 1, s.ActiveSessions)
	require.EqualValues(t, 0, s.Sessions, "session isn't finished yet")
	require.Positive(t, s.BusyTime, "an open session must still count as busy")
	require.Positive(t, s.SumSessionTime, "an open session must contribute elapsed time")
}

// TestSessionEndIsIdempotent covers `defer end()` on a path that also ends the
// session explicitly — double-counting there would corrupt every denominator.
func TestSessionEndIsIdempotent(t *testing.T) {
	tr := NewTracker(time.Now())

	end := tr.SessionStart("spaceA")
	time.Sleep(20 * time.Millisecond)
	end()
	first := tr.Snapshot()
	end()
	end()
	second := tr.Snapshot()

	require.EqualValues(t, 1, second.Sessions)
	require.Zero(t, second.ActiveSessions)
	require.Equal(t, first.SumSessionTime, second.SumSessionTime)
}

// TestRecordWriteExcludesNothingItShouldnt is a sanity check that the
// numerator only moves on explicit calls.
func TestRecordWriteAccumulates(t *testing.T) {
	tr := NewTracker(time.Now())
	tr.RecordWrite(3, 300)
	tr.RecordWrite(2, 200)
	tr.RecordWrite(0, 0)

	s := tr.Snapshot()
	require.EqualValues(t, 5, s.Blobs)
	require.EqualValues(t, 500, s.Bytes)
}

func TestZeroDenominatorsDoNotPanic(t *testing.T) {
	s := NewTracker(time.Now()).Snapshot()
	require.Zero(t, s.ActiveThroughput())
	require.Zero(t, s.PerSessionThroughput())
	require.Zero(t, s.AvgConcurrency())
	require.GreaterOrEqual(t, s.DutyCycle(), 0.0)
}

// TestClassifyArrival pins the rules deciding what enters each histogram. The
// crucial asymmetry: backfill has a perfectly usable AGE (that's the catch-up
// metric) while being excluded from DELAY (which only measures fresh content).
func TestClassifyArrival(t *testing.T) {
	sessionStart := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		claimed    time.Time
		observed   time.Time
		wantAge    time.Duration
		wantAgeOK  bool
		wantReason string
	}{
		{
			name:      "fresh blob feeds both histograms",
			claimed:   sessionStart.Add(1 * time.Minute),
			observed:  sessionStart.Add(1*time.Minute + 30*time.Second),
			wantAge:   30 * time.Second,
			wantAgeOK: true,
		},
		{
			name:       "backfill feeds age but not delay",
			claimed:    sessionStart.Add(-72 * time.Hour),
			observed:   sessionStart.Add(1 * time.Minute),
			wantAge:    72*time.Hour + time.Minute,
			wantAgeOK:  true,
			wantReason: SkipBeforeSessionStart,
		},
		{
			name:       "claimed exactly at session start is still backfill",
			claimed:    sessionStart,
			observed:   sessionStart.Add(1 * time.Minute),
			wantAge:    time.Minute,
			wantAgeOK:  true,
			wantReason: SkipBeforeSessionStart,
		},
		{
			name:       "no timestamp feeds neither",
			claimed:    time.Time{},
			observed:   sessionStart.Add(1 * time.Minute),
			wantAgeOK:  false,
			wantReason: SkipNoTimestamp,
		},
		{
			name:       "peer clock ahead of ours feeds neither",
			claimed:    sessionStart.Add(5 * time.Minute),
			observed:   sessionStart.Add(4 * time.Minute),
			wantAgeOK:  false,
			wantReason: SkipNegativeSkew,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a := classifyArrival(tt.observed, tt.claimed, sessionStart)
			require.Equal(t, tt.wantAgeOK, a.AgeOK, "AgeOK")
			require.Equal(t, tt.wantReason, a.DelayReason, "DelayReason")
			if tt.wantAgeOK {
				require.Equal(t, tt.wantAge, a.Age, "Age")
			}
		})
	}
}

// TestBackfillStillCountsTowardAge is the behaviour that motivated the second
// histogram: during a cold catch-up every blob is backfill, so the delay
// histogram stays empty while the age histogram is the one carrying signal.
func TestBackfillStillCountsTowardAge(t *testing.T) {
	tr := NewTracker(time.Now())

	beforeAge := histogramCount(t, mAge, "Change")
	beforeDelay := histogramCount(t, mDelay, "Change")
	beforeSkip := counterValue(t, SkipBeforeSessionStart)

	// A change authored a year ago, received now: classic fresh-start backfill.
	tr.RecordDelay("Change", time.Now(), time.Now().Add(-365*24*time.Hour))

	require.Equal(t, beforeAge+1, histogramCount(t, mAge, "Change"),
		"backfill must be counted as content age")
	require.Equal(t, beforeDelay, histogramCount(t, mDelay, "Change"),
		"backfill must NOT be counted as delivery delay")
	require.Equal(t, beforeSkip+1, counterValue(t, SkipBeforeSessionStart),
		"the delay exclusion must stay visible")
}

// TestFreshArrivalCountsTowardBoth is the control for the test above.
func TestFreshArrivalCountsTowardBoth(t *testing.T) {
	tr := NewTracker(time.Now().Add(-time.Hour))

	beforeAge := histogramCount(t, mAge, "Ref")
	beforeDelay := histogramCount(t, mDelay, "Ref")

	claimed := time.Now().Add(-5 * time.Second)
	tr.RecordDelay("Ref", time.Now(), claimed)

	require.Equal(t, beforeAge+1, histogramCount(t, mAge, "Ref"))
	require.Equal(t, beforeDelay+1, histogramCount(t, mDelay, "Ref"))
}

// TestRecordDelayIgnoresNonNetworkArrivals: a zero observation time means the
// blob was authored locally or replayed by a reindex, so it must never reach
// the histogram — otherwise near-zero delays would swamp the percentiles.
func TestRecordDelayIgnoresNonNetworkArrivals(t *testing.T) {
	tr := NewTracker(time.Now())
	before := counterValue(t, SkipNoTimestamp)
	tr.RecordDelay("Change", time.Time{}, time.Time{})
	require.Equal(t, before, counterValue(t, SkipNoTimestamp),
		"a zero observation time must not even be classified")
}

func TestSetSessionStartMovesTheCutoff(t *testing.T) {
	tr := NewTracker(time.Now().Add(-time.Hour))
	newStart := time.Now()
	tr.SetSessionStart(newStart)
	require.Equal(t, newStart, tr.SessionStartTime())

	// A blob claimed 30 minutes ago was fresh under the old anchor and is
	// backfill under the new one.
	a := classifyArrival(time.Now(), time.Now().Add(-30*time.Minute), tr.SessionStartTime())
	require.Equal(t, SkipBeforeSessionStart, a.DelayReason)
}
