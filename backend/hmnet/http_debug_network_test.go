package hmnet

import (
	"math"
	"strings"
	"testing"

	"seed/backend/hmnet/syncing"

	dto "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/require"
)

func bucket(upper float64, cum uint64) *dto.Bucket {
	u := upper
	c := cum
	return &dto.Bucket{UpperBound: &u, CumulativeCount: &c}
}

func TestHistStatsPercentileEmpty(t *testing.T) {
	h := &histStats{count: 0, buckets: []*dto.Bucket{bucket(1.0, 0)}}
	require.Equal(t, -1.0, h.percentile(0.5))
}

func TestHistStatsPercentileOnBoundary(t *testing.T) {
	// 10 observations all in the (0, 1.0] bucket.
	// p=0.5 → target=5. Cumulative count of bucket[0] is exactly 10,
	// frac = (5-0)/(10-0) = 0.5, result = 0 + 0.5 * (1.0 - 0) = 0.5.
	h := &histStats{
		count: 10,
		buckets: []*dto.Bucket{
			bucket(1.0, 10),
			bucket(2.0, 10),
		},
	}
	require.InDelta(t, 0.5, h.percentile(0.5), 1e-9)
}

func TestHistStatsPercentileInterpolatesQuarterIntoBucket(t *testing.T) {
	// Bucket 0 (upper=1.0) is empty. Bucket 1 (1.0, 2.0] has 4 observations.
	// p=0.25 → target=1. After bucket 0 we have prevUpper=1.0, prevCount=0.
	// cum at bucket 1 is 4, frac = (1-0)/(4-0) = 0.25,
	// result = 1.0 + 0.25 * (2.0 - 1.0) = 1.25.
	h := &histStats{
		count: 4,
		buckets: []*dto.Bucket{
			bucket(1.0, 0),
			bucket(2.0, 4),
		},
	}
	require.InDelta(t, 1.25, h.percentile(0.25), 1e-9)
}

func TestHistStatsPercentileFallsBackForInfBucket(t *testing.T) {
	// All observations land in the +Inf overflow bucket; the renderer
	// has no finite upper to interpolate to, so it must fall back to
	// the previous (last finite) bucket's upper bound.
	h := &histStats{
		count: 10,
		buckets: []*dto.Bucket{
			bucket(1.0, 0),
			bucket(2.0, 0),
			bucket(math.Inf(+1), 10),
		},
	}
	require.Equal(t, 2.0, h.percentile(0.99))
}

func TestBuildScheduler_NilSnap(t *testing.T) {
	// A nil snapshot func must produce no scheduler section.
	require.Nil(t, buildScheduler(nil))
}

func TestBuildScheduler_WithSnap(t *testing.T) {
	snap := func() syncing.SchedulerSnapshot {
		return syncing.SchedulerSnapshot{
			TasksTotal:             5,
			QueueLen:               2,
			InProgress:             3,
			InProgressHot:          2,
			InProgressSubscription: 1,
			PreemptHotCount:        7,
			PreemptSubsCount:       11,
		}
	}

	got := buildScheduler(snap)
	require.NotNil(t, got)
	require.Equal(t, "5", got.TasksTotal)
	require.Equal(t, "2", got.QueueLen)
	require.Equal(t, "3", got.InProgress)
	require.Equal(t, "2", got.InProgressHot)
	require.Equal(t, "1", got.InProgressSubscription)
	require.Equal(t, "7", got.PreemptHotCount)
	require.Equal(t, "11", got.PreemptSubsCount)
}

// TestPageTpl_RendersSchedulerSection runs the actual page template with
// a populated Scheduler section to make sure the new <h2> block renders
// without template errors and contains the snapshot's numeric values.
func TestPageTpl_RendersSchedulerSection(t *testing.T) {
	page := networkPage{
		PeerID:     "peer-1",
		ProtocolID: "/test/0.0.1",
		Scheduler: &schedulerDebugSection{
			TasksTotal:             "42",
			QueueLen:               "5",
			InProgress:             "3",
			InProgressHot:          "2",
			InProgressSubscription: "1",
			PreemptHotCount:        "9",
			PreemptSubsCount:       "13",
		},
	}
	var sb strings.Builder
	require.NoError(t, pageTpl.Execute(&sb, page))
	html := sb.String()
	require.Contains(t, html, "Discovery scheduler")
	require.Contains(t, html, "42")
	require.Contains(t, html, "preempt total — older hot cancelled for newer hot")
}

func TestHistStatsPercentileSkipsEmptyEarlyBuckets(t *testing.T) {
	// Buckets 0 and 1 are empty; bucket 2 ((10ms, 100ms]) holds all
	// observations. p=0.5 → target=5. prevUpper after bucket 1 is 0.01.
	// frac = 5/10 = 0.5, result = 0.01 + 0.5 * (0.1 - 0.01) = 0.055.
	h := &histStats{
		count: 10,
		buckets: []*dto.Bucket{
			bucket(0.001, 0),
			bucket(0.01, 0),
			bucket(0.1, 10),
		},
	}
	require.InDelta(t, 0.055, h.percentile(0.5), 1e-9)
}
