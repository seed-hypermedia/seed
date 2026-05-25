package sqlitex

import (
	"context"
	"sync"
	"time"

	"seed/backend/util/sqlite"

	"github.com/prometheus/client_golang/prometheus"
)

// WAL checkpoint background goroutine.
//
// SQLite's WAL mode appends every committed page to a side file (the .wal).
// Readers read pages from the WAL on top of the main DB; writers append more
// frames. Eventually a checkpoint must relocate WAL frames back into the
// main DB file. By default SQLite auto-checkpoints inline on COMMIT once the
// WAL exceeds wal_autocheckpoint pages (1000 by default). That means a
// committing writer who happens to cross the threshold pays for the
// fsync of every dirty page being migrated — which is what surfaces as
// multi-hundred-millisecond COMMIT durations on /debug/sqlite under disk
// contention.
//
// Lifting the foreground checkpoint into a dedicated background goroutine
// running PRAGMA wal_checkpoint(PASSIVE) at a steady cadence amortises that
// cost away from the writer slot. PASSIVE never blocks writers, never blocks
// readers, and never changes what a reader sees — pages already-in-WAL are
// already visible to readers; checkpoint only relocates them to the main DB
// file with bit-identical content.
//
// One caveat: when the foreground writer is racing the background
// checkpointer for the writer slot they still serialize through BEGIN
// IMMEDIATE. But the checkpoint's wal_checkpoint(PASSIVE) is non-blocking
// from SQLite's perspective and is typically <50ms, so this is bounded
// even at worst case.

// CheckpointResult captures the last PRAGMA wal_checkpoint(PASSIVE) run.
//
// busy=1 indicates a reader/writer prevented checkpointing some frames —
// they will be retried on the next tick. log/checkpointed are in WAL frames
// (page-sized; typically 4 KiB each).
type CheckpointResult struct {
	When         time.Time
	Duration     time.Duration
	Busy         int64
	Log          int64 // total frames in WAL at the time of the call
	Checkpointed int64 // frames moved from WAL to main DB
	Err          error
}

// CheckpointSnapshot is the rolling view of background checkpoint activity
// surfaced on /debug/sqlite.
type CheckpointSnapshot struct {
	Last       CheckpointResult
	Recent     []CheckpointResult // most-recent-first ring buffer
	TotalRuns  uint64
	TotalPages uint64
}

type checkpointTracker struct {
	mu         sync.Mutex
	last       CheckpointResult
	recent     []CheckpointResult
	totalRuns  uint64
	totalPages uint64
}

const checkpointRingCap = 32

func (t *checkpointTracker) record(r CheckpointResult) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.last = r
	t.totalRuns++
	if r.Err == nil {
		t.totalPages += uint64(r.Checkpointed)
	}
	t.recent = append(t.recent, r)
	if len(t.recent) > checkpointRingCap {
		t.recent = t.recent[len(t.recent)-checkpointRingCap:]
	}
}

func (t *checkpointTracker) snapshot() CheckpointSnapshot {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := CheckpointSnapshot{
		Last:       t.last,
		TotalRuns:  t.totalRuns,
		TotalPages: t.totalPages,
	}
	out.Recent = make([]CheckpointResult, len(t.recent))
	for i, r := range t.recent {
		out.Recent[len(t.recent)-1-i] = r
	}
	return out
}

var globalCheckpointTracker = &checkpointTracker{}

// WALCheckpointSnapshot returns the current rolling view of background
// checkpoint activity. Safe for concurrent readers.
func WALCheckpointSnapshot() CheckpointSnapshot {
	return globalCheckpointTracker.snapshot()
}

var (
	mCheckpointDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "seed_sqlite_wal_checkpoint_duration_seconds",
		Help:    "Wall-clock duration of background PRAGMA wal_checkpoint(PASSIVE).",
		Buckets: []float64{0.001, 0.005, 0.025, 0.1, 0.25, 1, 2.5},
	})
	mCheckpointPages = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "seed_sqlite_wal_checkpoint_pages_total",
		Help: "Total pages migrated from WAL to main DB by the background checkpointer.",
	})
	mCheckpointWALPages = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "seed_sqlite_wal_size_pages",
		Help: "Pages currently in the WAL at the last checkpoint tick.",
	})
	mCheckpointBusy = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "seed_sqlite_wal_checkpoint_busy_total",
		Help: "Number of PASSIVE checkpoint runs that returned busy=1 (some frames could not be migrated this tick).",
	})
)

func init() {
	prometheus.MustRegister(mCheckpointDuration, mCheckpointPages, mCheckpointWALPages, mCheckpointBusy)
}

// StartWALCheckpointer launches a background goroutine that, at the given
// interval, runs PRAGMA wal_checkpoint(PASSIVE) on conn. The conn is
// dedicated to the checkpointer and is NOT part of the main Pool — that
// way a slow checkpoint (disk fsync stalls can push wal_checkpoint to
// >1 s even for tiny WALs) does NOT shrink the foreground pool by 1
// for the duration. The goroutine self-exits when pool.Closed() fires.
//
// The caller is responsible for opening conn (typically the same URI/
// flags used for the main pool, with the same prelude PRAGMAs applied)
// and for closing it after the returned stop function returns.
//
// Recommended interval: 1s-3s. Cadence below 1s wastes work; above 5s
// lets the WAL grow large enough that an eventual auto-checkpoint trip
// stalls a foreground writer.
//
// The returned stop function blocks until the goroutine has exited.
// It is safe to call stop() multiple times; subsequent calls are no-ops.
func StartWALCheckpointer(pool *Pool, conn *sqlite.Conn, interval time.Duration, log Logger) func() {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	if log == nil {
		log = nopLogger{}
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	go func() {
		defer close(done)
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-pool.Closed():
				return
			case <-t.C:
			}
			runOneCheckpoint(conn, log)
		}
	}()

	var stopOnce sync.Once
	return func() {
		stopOnce.Do(func() {
			cancel()
			<-done
		})
	}
}

// runOneCheckpoint executes one PASSIVE checkpoint on the dedicated
// conn and records the result. Errors are logged + recorded but do not
// terminate the loop — a transient SQLITE_BUSY (e.g. another writer
// crossing the WAL header at the wrong instant) just means we retry
// next tick.
func runOneCheckpoint(conn *sqlite.Conn, log Logger) {
	var busy, walLog, ckpt int64
	t0 := time.Now()
	execErr := Exec(conn, "PRAGMA wal_checkpoint(PASSIVE);", func(stmt *sqlite.Stmt) error {
		busy = stmt.ColumnInt64(0)
		walLog = stmt.ColumnInt64(1)
		ckpt = stmt.ColumnInt64(2)
		return nil
	})
	dur := time.Since(t0)

	res := CheckpointResult{
		When:         time.Now(),
		Duration:     dur,
		Busy:         busy,
		Log:          walLog,
		Checkpointed: ckpt,
		Err:          execErr,
	}
	globalCheckpointTracker.record(res)

	if execErr != nil {
		log.Warn("WALCheckpointFailed", "err", execErr, "duration", dur)
		return
	}

	mCheckpointDuration.Observe(dur.Seconds())
	mCheckpointWALPages.Set(float64(walLog))
	if ckpt > 0 {
		mCheckpointPages.Add(float64(ckpt))
	}
	if busy != 0 {
		mCheckpointBusy.Inc()
	}
}

// Logger is a minimal logging interface so this package doesn't take a
// zap dependency. Implementations can adapt zap.Logger via a small shim.
type Logger interface {
	Warn(msg string, keysAndValues ...any)
}

type nopLogger struct{}

func (nopLogger) Warn(string, ...any) {}
