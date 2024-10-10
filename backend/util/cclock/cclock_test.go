package cclock

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPrecision(t *testing.T) {
	c1 := New()
	c2 := New()

	t1 := c1.MustNow()
	time.Sleep(c1.Precision)
	t2 := c2.MustNow()

	require.Greater(t, t2, t1, "second timestamp must be greater than the first one even in unrelated clocks")
}

func TestClockCausality(t *testing.T) {
	clock := New()

	// Number of iterations is arbitrary.
	var last time.Time
	for i := 0; i < int(clock.SkewThreshold/clock.Precision); i++ {
		tt := clock.MustNow()
		if !last.Before(tt) {
			t.Fatalf("incorrect causality: prev=%s, current=%s %d", last, tt, i)
		}

		last = tt
	}
}

func TestTrack(t *testing.T) {
	clock := New()

	t1 := clock.MustNow()
	t2 := t1.Add(2 * clock.SkewThreshold)

	require.Error(t, clock.Track(t2), "tracking a timestamp from the future must fail if exceeds the tolerance threshold")

	t3 := t1.Add(3 * clock.Precision)
	require.NoError(t, clock.Track(t3))

	require.Equal(t, t3, clock.maxTime)
}
