package syncperf

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	// mDelay is how stale a blob was when it landed: the gap between the
	// timestamp its author claimed and the moment we received it. Labelled by
	// blob type (bounded at the handful of structural types) because the
	// answer differs per type — Refs and Changes ride the doc-structure fast
	// path while Comments come with the full recursive phase.
	//
	// The buckets span sub-second to six hours because both ends are real:
	// a push from a connected peer lands in well under a second, while a
	// subscription that only reconciles on its scheduled interval can sit for
	// an hour.
	mDelay = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_sync_blob_delay_seconds",
		Help:    "Delay between a blob's author-claimed timestamp and our receipt of it.",
		Buckets: []float64{0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 21600},
	}, []string{"type"})

	// mAge is the same subtraction as mDelay — receipt minus claimed timestamp
	// — but for EVERY blob we ingest, however old. Where mDelay asks "how
	// promptly does fresh content reach us?", this asks "how far back in
	// history are we currently pulling from?".
	//
	// Two daemons can ingest bytes at identical throughput while one serves
	// recent content and the other replays years-old history first; only the age
	// distribution separates them. A converging catch-up collapses the
	// distribution toward zero, so a flat p99 means backlog is being consumed
	// without converging.
	//
	// Buckets run to a few years because real corpora are that old.
	mAge = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name: "seed_sync_blob_age_seconds",
		Help: "Age of ingested blobs at the moment we received them (claimed timestamp to receipt), including backfill.",
		Buckets: []float64{
			1, 10, 60, 600, 3600, // second .. hour
			21600, 86400, // 6h, 1d
			604800, 2592000, // 1w, 30d
			7776000, 31536000, 94608000, // 90d, 1y, 3y
		},
	}, []string{"type"})

	// mDelaySkipped counts arrivals deliberately kept out of mDelay. Every
	// exclusion is counted rather than silently dropped, so the histogram's
	// coverage is auditable instead of having to be trusted:
	//
	//	before_session_start  authored while this daemon was offline; see RecordDelay
	//	no_timestamp          blob type carries no claimed ts (DagPB, Raw)
	//	negative_skew         peer claims a timestamp in our future
	//	deferred_unstash      surfaced from the stash, so its true arrival time is lost
	//	sentinel_timestamp    blob.ZeroUnixTime() genesis marker, not a real ts
	mDelaySkipped = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_sync_blob_delay_skipped_total",
		Help: "Blob arrivals excluded from the delay histogram, by reason.",
	}, []string{"reason"})
)

// Skip reasons. Exported so callers outside this package (the unstash cascade)
// can report an exclusion without stringly-typing it.
const (
	SkipBeforeSessionStart = "before_session_start"
	SkipNoTimestamp        = "no_timestamp"
	SkipNegativeSkew       = "negative_skew"
	SkipDeferredUnstash    = "deferred_unstash"
	SkipSentinelTimestamp  = "sentinel_timestamp"
)

func init() {
	prometheus.MustRegister(
		mDelay, mAge, mDelaySkipped,
		mWrittenBytesByKind, mWrittenBlobsByKind,
		newCollector(Default),
	)
}

// SkipDelay records that an arrival was deliberately left out of the delay
// histogram, keeping the coverage gap visible.
func (t *Tracker) SkipDelay(reason string) {
	mDelaySkipped.WithLabelValues(reason).Inc()
}

// RecordDelay observes one blob landing locally, feeding both arrival
// histograms from a single subtraction.
//
// observed is when the blob arrived from the network; a zero value means it
// didn't arrive from the network at all (local publish, reindex) and nothing is
// recorded. claimed is the timestamp the blob's author put on it.
//
// Every usable arrival contributes its age to mAge. Only those claiming a
// timestamp AFTER this session started also contribute to mDelay: anything
// older is backfill authored while this daemon was offline, and mixing it into
// the delay histogram would produce values bounded by how long we were away
// rather than by how quickly the network delivers fresh writes.
func (t *Tracker) RecordDelay(blobType string, observed, claimed time.Time) {
	if observed.IsZero() {
		return
	}

	a := classifyArrival(observed, claimed, t.SessionStartTime())
	if !a.AgeOK {
		mDelaySkipped.WithLabelValues(a.DelayReason).Inc()
		return
	}

	// Age covers the whole corpus, backfill included.
	mAge.WithLabelValues(blobType).Observe(a.Age.Seconds())

	if a.DelayReason != "" {
		mDelaySkipped.WithLabelValues(a.DelayReason).Inc()
		return
	}
	mDelay.WithLabelValues(blobType).Observe(a.Age.Seconds())
}

// arrival is the classification of one blob landing locally. Split out from
// RecordDelay so the gating rules are testable without touching a registry.
type arrival struct {
	// Age is how long after its claimed timestamp the blob reached us.
	// Meaningful only when AgeOK.
	Age time.Duration

	// AgeOK is false when no usable age could be computed at all, which means
	// the arrival belongs in neither histogram.
	AgeOK bool

	// DelayReason, when non-empty, is why this arrival must stay out of the
	// delay histogram. Note it can be set while AgeOK is true: backfill has a
	// perfectly good age, it just isn't a delay measurement.
	DelayReason string
}

func classifyArrival(observed, claimed, sessionStart time.Time) arrival {
	if claimed.IsZero() {
		return arrival{DelayReason: SkipNoTimestamp}
	}

	// blob.ZeroUnixTime() — the Unix epoch — is a determinism sentinel, not a
	// real authoring time. Every Account/Space home document has a genesis
	// Change and genesis Ref stamped with it so their CIDs are reproducible.
	// Treated as content age those read as ~56 years, which overflows the top
	// bucket and single-handedly dominates the mean for Change and Ref. Note
	// this is distinct from claimed.IsZero(), which is Go's year-1 zero value.
	if claimed.Unix() == 0 {
		return arrival{DelayReason: SkipSentinelTimestamp}
	}

	age := observed.Sub(claimed)
	if age < 0 {
		// The peer claims a timestamp in our future. cclock tolerates tens of
		// seconds of skew between peers, so this happens legitimately; a
		// negative sample would drag every percentile down, so bucket it
		// separately rather than clamping it to zero.
		return arrival{DelayReason: SkipNegativeSkew}
	}

	if !claimed.After(sessionStart) {
		return arrival{Age: age, AgeOK: true, DelayReason: SkipBeforeSessionStart}
	}
	return arrival{Age: age, AgeOK: true}
}

// collector publishes the Tracker's state on scrape. Pull-based (rather than
// mirroring every counter into a prometheus.Counter on the write path) so the
// Tracker stays the single source of truth and the hot path stays a plain
// atomic add.
//
// Time is deliberately exported as a _seconds_total counter rather than a
// precomputed rate gauge: that lets Prometheus derive any window for free —
// active throughput is rate(written_bytes) / rate(busy_seconds), and duty
// cycle is just rate(busy_seconds).
type collector struct {
	t *Tracker

	writtenBytes         *prometheus.Desc
	writtenBlobs         *prometheus.Desc
	busySeconds          *prometheus.Desc
	sessionSeconds       *prometheus.Desc
	sessions             *prometheus.Desc
	activeSessions       *prometheus.Desc
	uptimeSeconds        *prometheus.Desc
	stageSeconds         *prometheus.Desc
	stageWeightedSeconds *prometheus.Desc
}

func newCollector(t *Tracker) *collector {
	return &collector{
		t: t,
		writtenBytes: prometheus.NewDesc(
			"seed_sync_written_bytes_total",
			"Uncompressed bytes of network-received blobs actually persisted (excludes blobs we already had).",
			nil, nil),
		writtenBlobs: prometheus.NewDesc(
			"seed_sync_written_blobs_total",
			"Network-received blobs actually persisted (excludes blobs we already had).",
			nil, nil),
		busySeconds: prometheus.NewDesc(
			"seed_sync_busy_seconds_total",
			"Wall-clock seconds during which at least one sync session was in flight (union, not sum).",
			nil, nil),
		sessionSeconds: prometheus.NewDesc(
			"seed_sync_session_seconds_total",
			"Sum of every sync session's duration; exceeds busy_seconds when sessions overlap.",
			nil, nil),
		sessions: prometheus.NewDesc(
			"seed_sync_sessions_total",
			"Completed sync sessions.",
			nil, nil),
		activeSessions: prometheus.NewDesc(
			"seed_sync_active_sessions",
			"Sync sessions currently in flight.",
			nil, nil),
		uptimeSeconds: prometheus.NewDesc(
			"seed_sync_uptime_seconds",
			"Seconds since the sync session start; the denominator of wall throughput.",
			nil, nil),
		stageSeconds: prometheus.NewDesc(
			"seed_sync_stage_seconds_total",
			"Wall-clock seconds partitioned by the highest sync stage occupied (idle|connecting|exchange|transfer). Disjoint; sums to uptime.",
			[]string{"stage"}, nil),
		stageWeightedSeconds: prometheus.NewDesc(
			"seed_sync_stage_weighted_seconds_total",
			"Wall-clock seconds split across sync stages in proportion to occupancy. Unlike the exclusive partition this keeps discriminating at high concurrency. Sums to uptime.",
			[]string{"stage"}, nil),
	}
}

func (c *collector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.writtenBytes
	ch <- c.writtenBlobs
	ch <- c.busySeconds
	ch <- c.sessionSeconds
	ch <- c.sessions
	ch <- c.activeSessions
	ch <- c.uptimeSeconds
	ch <- c.stageSeconds
}

func (c *collector) Collect(ch chan<- prometheus.Metric) {
	s := c.t.Snapshot()
	ch <- prometheus.MustNewConstMetric(c.writtenBytes, prometheus.CounterValue, float64(s.Bytes))
	ch <- prometheus.MustNewConstMetric(c.writtenBlobs, prometheus.CounterValue, float64(s.Blobs))
	ch <- prometheus.MustNewConstMetric(c.busySeconds, prometheus.CounterValue, s.BusyTime.Seconds())
	ch <- prometheus.MustNewConstMetric(c.sessionSeconds, prometheus.CounterValue, s.SumSessionTime.Seconds())
	ch <- prometheus.MustNewConstMetric(c.sessions, prometheus.CounterValue, float64(s.Sessions))
	ch <- prometheus.MustNewConstMetric(c.activeSessions, prometheus.GaugeValue, float64(s.ActiveSessions))
	ch <- prometheus.MustNewConstMetric(c.uptimeSeconds, prometheus.GaugeValue, s.Uptime.Seconds())

	st := c.t.Stages()
	for stage, d := range map[Stage]time.Duration{
		StageIdle:       st.Idle,
		StageConnecting: st.Connecting,
		StageExchange:   st.Exchange,
		StageTransfer:   st.Transfer,
	} {
		ch <- prometheus.MustNewConstMetric(c.stageSeconds, prometheus.CounterValue, d.Seconds(), stage.String())
	}
	for stage, d := range map[Stage]time.Duration{
		StageIdle:       st.WeightedIdle,
		StageConnecting: st.WeightedConnecting,
		StageExchange:   st.WeightedExchange,
		StageTransfer:   st.WeightedTransfer,
	} {
		ch <- prometheus.MustNewConstMetric(c.stageWeightedSeconds, prometheus.CounterValue, d.Seconds(), stage.String())
	}
}
