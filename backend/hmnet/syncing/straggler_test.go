package syncing

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestShouldDropStragglers covers the gate that keeps a connected-sync wave
// draining while a complete peer still owes a large reconciled backlog, instead
// of cutting it as a "straggler tail" the instant downloads gap — plus the warm
// fast-path that cuts immediately when nothing is owed.
func TestShouldDropStragglers(t *testing.T) {
	const quorum = 21 // 70% of 30 peers

	tests := []struct {
		name                      string
		completed                 int64
		idle                      time.Duration
		maxReconciled, downloaded int32
		want                      bool
	}{
		{"no quorum yet", 10, 10 * time.Second, 0, 0, false},
		// Warm fast-path: quorum done, nothing reconciled still owed — cut now.
		{"warm: quorum + nothing owed cuts without grace", 25, 1 * time.Second, 0, 0, true},
		{"warm: few updates already fetched cuts without grace", 25, 500 * time.Millisecond, 50, 50, true},
		// Content still owed but idle below grace — keep waiting.
		{"quorum but idle below grace, content owed", 25, 2 * time.Second, 5000, 100, false},
		{"empty wave cuts on grace", 25, stragglerGrace, 0, 0, true},
		{"warm laggard near-done cuts on grace", 25, stragglerGrace, 5000, 4990, true},
		// A complete peer reconciled 26375, only 6015 downloaded: the bulk is still
		// owed (a bursty delivery gap, not the end), so do NOT cut on the short grace.
		{"cold bulk keeps draining", 23, 6 * time.Second, 26375, 6015, false},
		{"cold bulk still draining near backstop", 23, 29 * time.Second, 26375, 6015, false},
		// Genuinely stalled past the backstop with a backlog -> content isn't coming
		// from these peers, cut + re-run.
		{"stalled past backstop cuts despite backlog", 23, stragglerStallBackstop, 26375, 6015, true},
		// A small tail (within 5% / 256) counts as near-done.
		{"five percent tail is near-done", 25, stragglerGrace, 10000, 9600, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldDropStragglers(tt.completed, quorum, tt.idle, tt.maxReconciled, tt.downloaded, false)
			require.Equal(t, tt.want, got)
		})
	}

	// quickDrain (root-directory render-handoff): once quorum is done and idle is
	// past the grace, cut even with a large backlog still owed — connected_sync
	// fetches it next. The same inputs WITHOUT quickDrain keep draining.
	t.Run("quickDrain cuts past grace despite large backlog", func(t *testing.T) {
		require.True(t, shouldDropStragglers(23, quorum, stragglerGrace, 26375, 6015, true))
		require.False(t, shouldDropStragglers(23, quorum, stragglerGrace, 26375, 6015, false))
	})
	t.Run("quickDrain still respects quorum and grace", func(t *testing.T) {
		require.False(t, shouldDropStragglers(10, quorum, stragglerGrace, 5000, 100, true), "no quorum -> keep")
		require.False(t, shouldDropStragglers(23, quorum, 2*time.Second, 5000, 100, true), "below grace -> keep")
	})
}

// TestShouldCutHotWave covers the interactive wave-cut policy: a hot round must
// end once a few live peers have fully synced with nothing owed and downloads
// idle past the short hot grace — the completion quorum counts failures, so a
// fleet of stale peers otherwise gates the round at the pace of their dial
// timeouts (the observed 60s viewed-document latency with 34 dead peers of 60).
func TestShouldCutHotWave(t *testing.T) {
	tests := []struct {
		name        string
		syncedOK    int64
		total       int
		idle        time.Duration
		outstanding int64
		want        bool
	}{
		// The completion quorum (70% of 60 = 42) would still be waiting on dead
		// peers in every one of these; the hot policy only needs 3 successes.
		{"not enough successes even when fully idle", 2, 60, time.Minute, 0, false},
		{"success quorum but content still owed", 3, 60, time.Minute, 10, false},
		{"success quorum, nothing owed, idle below hot grace", 3, 60, time.Second, 0, false},
		{"success quorum, nothing owed, idle past hot grace", 3, 60, stragglerHotGrace, 0, true},
		{"negative outstanding counts as nothing owed", 3, 60, stragglerHotGrace, -5, true},
		{"small wave caps the success quorum at wave size", 1, 1, stragglerHotGrace, 0, true},
		{"small wave still needs its capped quorum", 0, 1, stragglerHotGrace, 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, shouldCutHotWave(tt.syncedOK, tt.total, tt.idle, tt.outstanding))
		})
	}
}

// TestShouldKeepDrainingTier covers the per-tier gate: a large still-owed backlog
// within the idle-strike budget keeps waiting (transient delivery gap); a small
// tail (absolute or relative to the tier) or an exhausted budget abandons.
func TestShouldKeepDrainingTier(t *testing.T) {
	// Large backlog (50% of tier) is a transient gap: keep waiting within the
	// strike budget, abandon once it's exhausted.
	require.True(t, shouldKeepDrainingTier(5000, 10000, 1), "large backlog, first idle window -> keep waiting")
	require.True(t, shouldKeepDrainingTier(5000, 10000, maxIdleStrikes-1), "large backlog, under strike cap -> keep waiting")
	require.False(t, shouldKeepDrainingTier(5000, 10000, maxIdleStrikes), "large backlog but strike cap reached -> abandon")

	// Absolute near-done: a tiny tail abandons on the first strike.
	require.False(t, shouldKeepDrainingTier(tierIdleNearDone, 100000, 1), "tail at absolute near-done threshold -> abandon")
	require.False(t, shouldKeepDrainingTier(0, 100000, 1), "nothing owed -> abandon")

	// Relative near-done: ~3% of the tier (above the absolute band but within 5%)
	// abandons on the first strike, avoiding a ~30s dead zone on a phantom tail.
	require.False(t, shouldKeepDrainingTier(110, 3585, 1), "small relative tail -> abandon on first strike")
	// Just above the 5% band stays in the keep-draining regime.
	require.True(t, shouldKeepDrainingTier(200, 3585, 1), "tail above 5% band -> keep waiting")
}
