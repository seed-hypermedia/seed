// Package syncperf measures how fast the daemon ingests content from the
// network, and how stale that content is by the time it lands.
//
// Everything here is deliberately cheap. Every value comes from data the sync
// and indexing paths already hold: byte counts from the block the blockstore
// just decided to write, timestamps from fields the indexer already decodes,
// and elapsed time from an in-memory mutex. Nothing in this package issues a
// SQLite statement, takes a database lock, or runs inside a write transaction,
// so it cannot slow down real queries.
package syncperf

import (
	"sync"
	"sync/atomic"
	"time"
)

// Tracker measures sync write throughput: one byte count over three different
// time denominators.
//
//	Uptime          wall time since the session started
//	BusyTime        the UNION of intervals with at least one sync in flight,
//	                so overlapping sessions count their shared wall time once
//	SumSessionTime  the sum of every session's duration
//
// Three are needed because sync is bursty and concurrent. Bytes over one
// session's elapsed time reports the speed of a burst, not the catch-up rate a
// user waiting through the gaps experiences; and summing session durations
// double-counts wall time that overlapping sessions shared.
//
// Dividing bytes by each gives the perceived catch-up rate, the rate while
// actually flowing, and the rate of a single stream. Two derived ratios relate
// them: DutyCycle = BusyTime/Uptime and AvgConcurrency = SumSessionTime/
// BusyTime, with wall = active × dutyCycle holding by construction.
type Tracker struct {
	mu sync.Mutex
	// start anchors Uptime and gates delay observations. Guarded by mu
	// because SetSessionStart may move it after construction.
	start time.Time
	// active is the number of sync sessions currently in flight.
	active int
	// busySince is when active last went 0 -> 1, i.e. the start of the
	// currently open busy interval. Meaningless when active == 0.
	busySince time.Time
	// openStartSum is the sum of the Unix-nano start times of the sessions
	// currently open. It lets Snapshot compute the in-flight contribution to
	// SumSessionTime in O(1) as active*now - openStartSum, instead of keeping
	// a list of open sessions around.
	openStartSum int64
	busyNanos    int64
	sumNanos     int64
	sessions     int64

	bytes atomic.Int64
	blobs atomic.Int64

	// bmu guards the per-site write breakdown. Separate from mu because it is
	// touched once per committed batch (not per session boundary) and read only
	// when the debug page is fetched.
	//
	// sites is the only structure here that grows with traffic rather than
	// being fixed-size, so it is explicitly capped: at maxBreakdownSites new
	// spaces fold into one overflow bucket instead of adding entries. Worst
	// case is maxBreakdownSites * (2 maps * len(Kinds)) counters — single-digit
	// megabytes — no matter how long the daemon runs or how many blobs it
	// ingests. Everything else in the Tracker is a scalar or a fixed-size
	// array, and the Prometheus metrics all use closed label sets (blob types,
	// skip reasons, stages).
	bmu   sync.Mutex
	sites map[string]*counts

	// docs holds bytes for blobs whose space wasn't known when they were
	// indexed, keyed by the document's genesis multihash. Changes are the case:
	// a Change carries no resource IRI, so it can only be tied to a space once
	// a Ref for the same genesis has been indexed — which the debug page
	// resolves from the database at render time.
	//
	// This grows with the number of distinct DOCUMENTS, not with blob volume:
	// a document with ten thousand changes is one entry. Capped at
	// maxBreakdownDocs, past which bytes go to the unattributed bucket rather
	// than being dropped.
	docs map[string]*counts

	// smu guards the stage partition. Separate from mu because stages turn over
	// per peer-sync phase — far more often than session boundaries — and holding
	// the session lock there would make it a contention point.
	smu            sync.Mutex
	stageOccupancy [numStages]int
	stageNanos     [numStages]int64
	stageWeighted  [numStages]int64
	stageSince     time.Time

	// stmu guards the per-space mirror of the session and stage bookkeeping
	// above, so every row of the throughput table can be broken down by site.
	//
	// Its own lock, and never held together with mu or smu: the session and
	// stage paths each take their global lock, release it, then take this one.
	// Same cap as the byte breakdown, ~120 bytes per space.
	stmu       sync.Mutex
	siteStates map[string]*siteState
}

// Default is the process-wide tracker. Its session start defaults to process
// start; the daemon moves it to its own boot time via SetSessionStart.
var Default = NewTracker(time.Now())

// NewTracker returns a tracker anchored at start. Only Default is wired up to
// Prometheus; trackers built here are for tests.
func NewTracker(start time.Time) *Tracker {
	return &Tracker{start: start}
}

// SetSessionStart re-anchors the tracker. Call once during startup, before any
// syncing begins: it defines both the Uptime denominator and the cutoff below
// which arrival delays are treated as offline backfill.
func (t *Tracker) SetSessionStart(start time.Time) {
	t.mu.Lock()
	t.start = start
	t.mu.Unlock()
}

// SessionStart marks a sync session as in flight and returns the func that
// ends it. The returned func is idempotent, so `defer end()` is safe even on
// paths that also end the session explicitly.
//
// site is the space this session is syncing, used to break the session figures
// down per space. Empty is fine — those land under the unattributed bucket.
func (t *Tracker) SessionStart(site string) (end func()) {
	started := time.Now()

	t.mu.Lock()
	t.active++
	t.openStartSum += started.UnixNano()
	if t.active == 1 {
		t.busySince = started
	}
	t.mu.Unlock()
	t.sessionStart(site, started)

	var once sync.Once
	return func() {
		once.Do(func() {
			ended := time.Now()
			t.mu.Lock()
			t.active--
			t.openStartSum -= started.UnixNano()
			t.sumNanos += ended.Sub(started).Nanoseconds()
			t.sessions++
			// Closing the last open session closes the busy interval, so its
			// full wall span lands in busyNanos exactly once no matter how
			// many sessions overlapped inside it.
			if t.active == 0 {
				t.busyNanos += ended.Sub(t.busySince).Nanoseconds()
			}
			t.mu.Unlock()
			t.sessionEnd(site, started, ended)
		})
	}
}

// RecordWrite adds blobs that genuinely reached the disk. Callers must exclude
// blobs the blockstore bounced because we already had them: those wrote zero
// bytes, and counting them would report throughput we never achieved.
func (t *Tracker) RecordWrite(blobs, bytes int64) {
	if blobs > 0 {
		t.blobs.Add(blobs)
	}
	if bytes > 0 {
		t.bytes.Add(bytes)
	}
}

// SessionStartTime returns the instant this tracker is anchored at.
func (t *Tracker) SessionStartTime() time.Time {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.start
}

// Snapshot is a consistent read of the tracker.
type Snapshot struct {
	Uptime         time.Duration
	BusyTime       time.Duration
	SumSessionTime time.Duration
	ActiveSessions int
	Sessions       int64
	Bytes          int64
	Blobs          int64
}

// Snapshot reads the tracker, including the intervals still open right now.
// Folding those in matters: without it a page loaded in the middle of a burst
// — precisely when someone is watching — would report the burst as zero.
func (t *Tracker) Snapshot() Snapshot {
	now := time.Now()

	t.mu.Lock()
	s := Snapshot{
		ActiveSessions: t.active,
		Sessions:       t.sessions,
		BusyTime:       time.Duration(t.busyNanos),
		SumSessionTime: time.Duration(t.sumNanos),
		Uptime:         now.Sub(t.start),
	}
	if t.active > 0 {
		s.BusyTime += now.Sub(t.busySince)
		s.SumSessionTime += time.Duration(int64(t.active)*now.UnixNano() - t.openStartSum)
	}
	t.mu.Unlock()

	s.Bytes = t.bytes.Load()
	s.Blobs = t.blobs.Load()
	return s
}

// WallThroughput is bytes per second of wall clock since the session started.
// This is the number that matches the user's perception of catch-up speed, and
// the one to quote when asked "how fast do we sync?".
func (s Snapshot) WallThroughput() float64 { return perSecond(s.Bytes, s.Uptime) }

// ActiveThroughput is bytes per second measured only over the time at least
// one sync was in flight: the capacity of the network plus write path,
// independent of how often the scheduler chooses to use it.
func (s Snapshot) ActiveThroughput() float64 { return perSecond(s.Bytes, s.BusyTime) }

// PerSessionThroughput is bytes per second per concurrent sync stream: the
// same bytes over the concurrency-weighted sum of session durations. Much
// lower than ActiveThroughput means we depend on fan-out to go fast.
func (s Snapshot) PerSessionThroughput() float64 { return perSecond(s.Bytes, s.SumSessionTime) }

// DutyCycle is the fraction of wall clock spent with a sync in flight. It is
// the bridge between the two throughputs: wall = active × dutyCycle. A low
// duty cycle alongside high ActiveThroughput means the pipe is fine and the
// scheduler is idle — the gaps, not the transfers, are the bottleneck.
func (s Snapshot) DutyCycle() float64 {
	if s.Uptime <= 0 {
		return 0
	}
	return s.BusyTime.Seconds() / s.Uptime.Seconds()
}

// AvgConcurrency is how many sessions ran in parallel on average while we were
// busy. 1.0 means sessions never overlapped despite the worker pool.
func (s Snapshot) AvgConcurrency() float64 {
	if s.BusyTime <= 0 {
		return 0
	}
	return s.SumSessionTime.Seconds() / s.BusyTime.Seconds()
}

func perSecond(n int64, d time.Duration) float64 {
	if d <= 0 || n <= 0 {
		return 0
	}
	return float64(n) / d.Seconds()
}
