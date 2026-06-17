package syncing

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestShouldDropStragglers covers the gate that keeps a connected-sync wave
// draining while a complete peer still owes a large reconciled backlog, instead
// of cutting it as a "straggler tail" the instant downloads gap.
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
		{"quorum but idle below grace", 25, 2 * time.Second, 0, 0, false},
		{"empty wave cuts on grace", 25, stragglerGrace, 0, 0, true},
		{"warm laggard near-done cuts on grace", 25, stragglerGrace, 5000, 4990, true},
		// The home case: a peer reconciled 26375, only 6015 downloaded. The bulk
		// is still owed, so the wave must NOT be cut on the short grace.
		{"cold bulk keeps draining", 23, 6 * time.Second, 26375, 6015, false},
		{"cold bulk still draining near backstop", 23, 29 * time.Second, 26375, 6015, false},
		// Genuinely stalled: nothing arriving for the backstop window even though a
		// backlog remains -> the content isn't coming from these peers, cut + re-run.
		{"stalled past backstop cuts despite backlog", 23, stragglerStallBackstop, 26375, 6015, true},
		// A small tail (within 5% / 256) counts as near-done.
		{"five percent tail is near-done", 25, stragglerGrace, 10000, 9600, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldDropStragglers(tt.completed, quorum, tt.idle, tt.maxReconciled, tt.downloaded)
			require.Equal(t, tt.want, got)
		})
	}
}

// TestShouldKeepDrainingTier covers the per-tier gate: a large still-owed backlog
// within the idle-strike budget keeps waiting; a small tail or an exhausted
// budget abandons.
func TestShouldKeepDrainingTier(t *testing.T) {
	require.True(t, shouldKeepDrainingTier(5000, 1), "large backlog, first idle window -> keep waiting")
	require.True(t, shouldKeepDrainingTier(5000, maxIdleStrikes-1), "large backlog, under strike cap -> keep waiting")
	require.False(t, shouldKeepDrainingTier(5000, maxIdleStrikes), "large backlog but strike cap reached -> abandon")
	require.False(t, shouldKeepDrainingTier(tierIdleNearDone, 1), "tail at near-done threshold -> abandon")
	require.False(t, shouldKeepDrainingTier(0, 1), "nothing owed -> abandon")
}
