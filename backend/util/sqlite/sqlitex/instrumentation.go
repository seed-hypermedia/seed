package sqlitex

import (
	"fmt"
	"math"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"seed/backend/util/sqlite"

	"github.com/prometheus/client_golang/prometheus"
)

// Instrumentation for write transactions opened through WithTx.
//
// The goal is to be able to answer two questions from a running daemon:
//   1. Which caller is holding the SQLite writer slot for too long?
//   2. Which caller is most often getting SQLITE_BUSY on BEGIN IMMEDIATE?
//
// Per-caller counts, hold-time distributions and BUSY counters are exported as
// Prometheus metrics. A small in-memory ring buffer of recent slow transactions
// plus a snapshot of currently in-flight transactions back the /debug/sqlite
// HTML page (see debug_handler.go).
//
// Cardinality is capped at maxCallerLabels distinct labels; overflow falls
// under "other" so a regression that resolves callers from a hot path can't
// blow up the Prometheus series count.

const (
	maxCallerLabels = 64
	slowThreshold   = 100 * time.Millisecond
	// recentWriteCap caps the top-K ring of slowest write-side transactions
	// (commits/rollbacks/savepoint_top/savepoint and begin_busy/interrupted
	// attempts). 50 is enough to show a busy week of outliers without
	// flooding the page; the smaller cap reflects that write contention
	// rows are far more diagnostic per-entry than read rows.
	recentWriteCap = 50
	// recentReadCap caps the top-K ring of slowest read-side
	// (savepoint_ro) operations. Reads outnumber writes in a typical
	// daemon by a wide margin, so the cap is correspondingly larger to
	// catch occasional outliers across the long tail of list/get
	// endpoints.
	recentReadCap = 100
)

// txOutcome is the "outcome" label on the duration histogram.
type txOutcome string

const (
	outcomeCommit           txOutcome = "commit"
	outcomeRollback         txOutcome = "rollback"
	outcomeBeginBusy        txOutcome = "begin_busy"
	outcomeBeginInterrupted txOutcome = "begin_interrupted"
	// outcomeSavepoint is a SAVEPOINT issued while the connection was already
	// inside an outer transaction; it never owns the writer slot on its own,
	// so its duration is not lock-hold and is excluded from holdReserv.
	outcomeSavepoint txOutcome = "savepoint"
	// outcomeSavepointTop is a SAVEPOINT issued on an autocommit connection
	// that actually wrote at least once before RELEASE. The first write
	// statement promoted it to the writer-slot active set via the lazy
	// promoter on the capture buffer. Counts as real writer-slot hold time.
	// Used by the Pool.WithSave / Read[] / ExecScript paths that historically
	// bypassed WithTx and made the actual lock-hog invisible on /debug/sqlite.
	outcomeSavepointTop txOutcome = "savepoint_top"
	// outcomeSavepointReadOnly is a SAVEPOINT issued on an autocommit
	// connection that never wrote — the connection only ever held the SHARED
	// reader lock during the scope and cannot have caused SQLITE_BUSY on
	// anyone else's BEGIN IMMEDIATE. Excluded from hold/wait percentiles and
	// the active set, otherwise Read[]-driven callers (ListEvents, ListPeers,
	// etc.) would flood the writer-health page with irrelevant noise.
	outcomeSavepointReadOnly txOutcome = "savepoint_ro"
)

var (
	mTxDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_sqlite_writetx_duration_seconds",
		Help:    "Wall-clock duration of write transactions opened via sqlitex.WithTx, from BEGIN IMMEDIATE to COMMIT/ROLLBACK, labelled by caller.",
		Buckets: []float64{0.001, 0.005, 0.025, 0.1, 0.25, 1, 2.5, 10, 30},
	}, []string{"caller", "outcome"})

	mBeginWait = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "seed_sqlite_writetx_begin_wait_seconds",
		Help:    "Time spent waiting for BEGIN IMMEDIATE to succeed (includes the busy-handler backoff).",
		Buckets: []float64{0.0001, 0.001, 0.005, 0.025, 0.1, 0.5, 1, 2.5, 10},
	}, []string{"caller"})

	mBeginBusy = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_sqlite_begin_busy_total",
		Help: "Number of times BEGIN IMMEDIATE failed with SQLITE_BUSY after the busy_timeout expired.",
	}, []string{"caller"})

	mInFlight = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "seed_sqlite_writetx_inflight",
		Help: "Currently in-flight write transactions (between BEGIN IMMEDIATE success and COMMIT/ROLLBACK).",
	}, []string{"caller"})
)

func init() {
	prometheus.MustRegister(mTxDuration, mBeginWait, mBeginBusy, mInFlight)
}

// callerStats accumulates per-caller stats for the debug page, split into
// write-side and read-side sub-buckets. A given caller can appear in both
// (e.g. a service method that goes through Pool.WithTx for one branch and
// Pool.WithSave for another). The two buckets are populated and read
// independently so the rendered page can show them as separate tables.
//
// Percentiles are computed from fixed-size reservoirs (one for hold, one
// for begin_wait on the write side; only hold on the read side); each
// reservoir is cheap memory and we only have ~20-30 distinct callers in
// practice. Hold tells us whether THIS caller is the offender; wait tells
// us whether THIS caller is the victim (write-side only — read-only Saves
// never queue for the writer slot).
type callerStats struct {
	mu    sync.Mutex
	write writeStats
	read  readStats
}

// writeStats tracks observations from outcomes that interacted with the
// SQLite writer slot: outcomeCommit / outcomeRollback / outcomeBeginBusy /
// outcomeBeginInterrupted / outcomeSavepoint / outcomeSavepointTop.
type writeStats struct {
	count      uint64
	busyCount  uint64
	holdReserv []float64 // hold durations in ms; bounded
	waitReserv []float64 // begin_wait durations in ms; bounded
	commits    uint64
	rollbacks  uint64
}

// readStats tracks observations from outcomeSavepointReadOnly: top-level
// Save scopes that never promoted because their body only read from
// SQLite. These never own the writer slot, so busy/wait/commits/rollbacks
// are not meaningful for them — only count and hold (SHARED-lock hold).
type readStats struct {
	count      uint64
	holdReserv []float64 // hold durations in ms; bounded
}

// reservoirCap controls how many recent samples back each per-caller hold
// percentile. Bumped from 1024 → 8192 because the recent-slow ring covers a
// much longer time window than the reservoir for callers with rare slow
// events (the cap on the recent-slow ring is per total events, not per
// caller, so for a 2%-slow caller it spans ~50x more history than a fixed
// reservoir of all events). At 8192 floats per caller × 64-caller cap ≈
// 4 MiB; still cheap, and brings the windows closer so the visible recent
// max is reflected in p99 for high-frequency callers like syncing.loadStore.
const reservoirCap = 8192

func (s *callerStats) record(hold, wait time.Duration, outcome txOutcome) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if outcome == outcomeSavepointReadOnly {
		// Read-only top-level Save: track in the read sub-bucket only.
		// Hold here is the SHARED-lock hold; wait is meaningless (the
		// SAVEPOINT statement itself never blocks on the writer slot).
		s.read.count++
		appendReservoir(&s.read.holdReserv, hold, s.read.count)
		return
	}

	w := &s.write
	w.count++
	switch outcome {
	case outcomeCommit, outcomeSavepointTop:
		// Top-level SAVEPOINT that actually wrote, successfully released,
		// is the moral equivalent of a COMMIT — the writer slot was held
		// and the work persisted.
		w.commits++
	case outcomeRollback:
		w.rollbacks++
	case outcomeBeginBusy:
		w.busyCount++
	}

	// holdReserv tracks real writer-lock hold time. Only outcomes that
	// actually held the slot belong here: WithTx commits/rollbacks, plus
	// top-level SAVEPOINTs that promoted (outcomeSavepointTop — the lazy
	// promoter on the capture buffer fired because a write hit the conn).
	// Nested outcomeSavepoint is a sub-op inside an already-tracked outer
	// scope and would double-count. begin_busy and begin_interrupted
	// never started the tx (their "hold" is a synthetic copy of
	// begin_wait). Mixing any of those into the reservoir buries the
	// real percentiles and made the actual lock-hog invisible on
	// /debug/sqlite — see history at the offender-hunt audit.
	switch outcome {
	case outcomeCommit, outcomeRollback, outcomeSavepointTop:
		appendReservoir(&w.holdReserv, hold, w.count)
	}
	// waitReserv tracks how long the caller queued for the writer slot.
	// WithTx queues at BEGIN IMMEDIATE; a top-level SAVEPOINT that wrote
	// queues at the SAVEPOINT statement itself if another writer is
	// committing. A nested SAVEPOINT never queues for the writer slot.
	if outcome != outcomeSavepoint {
		appendReservoir(&w.waitReserv, wait, w.count)
	}
}

func appendReservoir(r *[]float64, d time.Duration, count uint64) {
	ms := float64(d) / float64(time.Millisecond)
	if len(*r) < reservoirCap {
		*r = append(*r, ms)
		return
	}
	(*r)[count%reservoirCap] = ms
}

// writeHoldPercentilesMs returns p10, p50, p90, p99 of writer-slot hold
// durations recorded under outcomes that owned the writer slot.
func (s *callerStats) writeHoldPercentilesMs() (p10, p50, p90, p99 float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return percentilesNearestRank(s.write.holdReserv)
}

// writeWaitPercentilesMs returns p10, p50, p90, p99 of begin_wait
// durations — how long this caller queued for the writer slot.
func (s *callerStats) writeWaitPercentilesMs() (p10, p50, p90, p99 float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return percentilesNearestRank(s.write.waitReserv)
}

// readHoldPercentilesMs returns p10, p50, p90, p99 of SHARED-lock hold
// durations recorded under outcomeSavepointReadOnly.
func (s *callerStats) readHoldPercentilesMs() (p10, p50, p90, p99 float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return percentilesNearestRank(s.read.holdReserv)
}

// percentilesNearestRank uses the nearest-rank method: with n<100 samples,
// p99 equals the max. Matches user intuition: a caller with 4 observations
// of max=571ms must read p99=571ms, not the linear-interpolation answer.
func percentilesNearestRank(reservoir []float64) (p10, p50, p90, p99 float64) {
	if len(reservoir) == 0 {
		return 0, 0, 0, 0
	}
	buf := make([]float64, len(reservoir))
	copy(buf, reservoir)
	sort.Float64s(buf)
	pick := func(p float64) float64 {
		n := len(buf)
		if n == 0 {
			return 0
		}
		idx := int(math.Ceil(p*float64(n))) - 1
		if idx < 0 {
			idx = 0
		} else if idx >= n {
			idx = n - 1
		}
		return buf[idx]
	}
	return pick(0.10), pick(0.50), pick(0.90), pick(0.99)
}

// txSample is a single recorded slow transaction kept in the ring buffer.
type txSample struct {
	When      time.Time
	Caller    string
	Hold      time.Duration
	BeginWait time.Duration
	Outcome   txOutcome
	// Stmts is the list of SQL statements (with bind args summarised) that
	// ran inside this transaction. Only populated for slow / busy samples
	// since capture is only active while a WithTx is recording.
	Stmts []capturedStmt
	// HeldBy is the set of write transactions that were in-flight at the
	// moment this caller's BEGIN IMMEDIATE returned BUSY. Populated only for
	// outcomeBeginBusy samples; for those rows it answers the "who had the
	// lock while I was failing?" question directly.
	HeldBy []activeTx
}

// capturedStmt is one statement executed inside an instrumented tx.
// Args are stored as a single rendered string with each arg truncated to
// keep the buffer bounded and avoid keeping large blobs alive.
//
// Duration is the wall time spent inside the statement's Step loop (and
// finalize, for ExecTransient). It includes the time the statement spent
// waiting on SQLite's busy handler if it had to back off, and the cost of
// COMMIT including any WAL checkpoint that fired. Renders next to the SQL
// on /debug/sqlite so a 49-stmt PutMany row shows which one statement
// (e.g. COMMIT, a recursive CTE, an FTS write) ate the time.
type capturedStmt struct {
	SQL      string
	Args     string
	Duration time.Duration
}

// txCapture is the buffer attached to a *sqlite.Conn for the lifetime of a
// WithTx body. Exec/ExecTransient append to it via captureExec; if no buffer
// is attached for the conn the capture path is a single sync.Map load that
// short-circuits to no-op.
//
// promote is the lazy "this Save just wrote something" callback used by
// top-level sqlitex.Save to defer its writer-slot accounting until an actual
// write hits the conn. Read-only Saves (the Read[] / ListEvents / ListPeers
// path) never invoke it and stay out of the active set and the hold
// percentile reservoir — they only ever held the SHARED reader lock and
// cannot cause SQLITE_BUSY on BEGIN IMMEDIATE. promoter is nil for WithTx
// buffers, which are already inside an instrumented writer-slot scope.
type txCapture struct {
	mu      sync.Mutex
	stmts   []capturedStmt
	promote func()
}

const (
	// captureStmtCap caps statements retained per tx. A typical PutMany batch
	// (10 blobs × ~10 indexer stmts/blob + propagateVisibilityBatch + COMMIT)
	// fits in ~120 stmts. 50 was too small: it filled up on the inner indexer
	// loop and silently dropped propagateVisibilityBatch + COMMIT — exactly
	// the statements most likely to be the time sink. 250 leaves headroom.
	captureStmtCap = 250
	captureArgsCap = 200 // max characters of formatted args retained per stmt
	captureSQLCap  = 400 // max characters of SQL retained per stmt (bulk INSERTs can be huge)
)

// captureBufs is per-conn capture state. A *sqlite.Conn key is unique and
// stable; WithTx Store/LoadAndDelete each pairs so there is no leak across
// transactions.
var captureBufs sync.Map // *sqlite.Conn -> *txCapture

func beginCapture(conn *sqlite.Conn) {
	captureBufs.Store(conn, &txCapture{})
}

// armCapturePromoter attaches a lazy "I just wrote something" callback to the
// capture buffer currently associated with conn. fn must be idempotent (the
// caller typically wraps a sync.Once around it); it will be invoked the first
// time a write statement runs inside the savepoint scope, and never again.
// If no buffer is attached, the call is a no-op — read-only callers without
// a writer-slot accounting scope simply don't need this signal.
func armCapturePromoter(conn *sqlite.Conn, fn func()) {
	v, ok := captureBufs.Load(conn)
	if !ok {
		return
	}
	c := v.(*txCapture)
	c.mu.Lock()
	c.promote = fn
	c.mu.Unlock()
}

func endCapture(conn *sqlite.Conn) []capturedStmt {
	v, ok := captureBufs.LoadAndDelete(conn)
	if !ok {
		return nil
	}
	c := v.(*txCapture)
	c.mu.Lock()
	out := make([]capturedStmt, len(c.stmts))
	copy(out, c.stmts)
	c.mu.Unlock()
	return out
}

// captureExecStart begins a timed capture for one statement executed inside
// an active tx. It reserves the slot, records the SQL/args, and returns a
// closure that stamps the elapsed time when the statement completes. The
// fast path (no active capture on this conn) is a single sync.Map load that
// short-circuits to a no-op closure.
//
// The slot reservation up front is important: it preserves chronological
// order of statements in the recent-tx panel even when long statements
// finish out-of-order on different goroutines (in practice they don't, but
// the invariant is cheap to maintain).
func captureExecStart(conn *sqlite.Conn, sql string, args []interface{}) func() {
	v, ok := captureBufs.Load(conn)
	if !ok {
		return noopCaptureDone
	}
	c := v.(*txCapture)
	c.mu.Lock()
	if len(c.stmts) >= captureStmtCap {
		c.mu.Unlock()
		return noopCaptureDone
	}
	idx := len(c.stmts)
	c.stmts = append(c.stmts, capturedStmt{
		SQL:  truncate(collapseSQL(sql), captureSQLCap),
		Args: formatArgs(args),
	})
	c.mu.Unlock()

	// Snapshot the promote callback once at start so we can fire it without
	// re-locking the buffer after Exec returns. Saved by value: the promoter
	// is sync.Once-guarded, so additional calls past the first are free.
	c.mu.Lock()
	promote := c.promote
	c.mu.Unlock()

	// Snapshot conn.Changes() BEFORE the statement runs. This is critical:
	// conn.Changes() is the row-count of the most recently completed DML on
	// this connection and is NOT reset by SELECT statements, NOT reset by
	// returning the conn to the pool, and NOT reset across savepoint scopes.
	// A pooled conn that previously ran an INSERT therefore reports a
	// non-zero Changes() forever after, so reading the raw value to decide
	// "did this statement write?" falsely promotes every Read[] / ListEvents
	// / ListPeers Save. The correct signal is the before/after delta around
	// each individual Exec: a SELECT leaves it unchanged, a successful DML
	// moves it. Combined with the SQL-prefix check for DDL and zero-row DML
	// attempts that don't move Changes() at all.
	var changesBefore int
	if promote != nil {
		changesBefore = conn.Changes()
	}

	t0 := time.Now()
	return func() {
		d := time.Since(t0)
		c.mu.Lock()
		if idx < len(c.stmts) {
			c.stmts[idx].Duration = d
		}
		c.mu.Unlock()

		// Lazy writer-slot promotion. Two complementary signals:
		//   - conn.Changes() before vs. after this Exec catches all DML
		//     that actually changed at least one row.
		//   - isWriteSQL(sql) catches DDL/maintenance verbs and DML that
		//     ran but affected zero rows (INSERT ... ON CONFLICT DO NOTHING,
		//     UPDATE ... WHERE no-match, etc.) — those still took the
		//     writer lock briefly even though Changes() doesn't advance.
		if promote != nil && (conn.Changes() != changesBefore || isWriteSQL(sql)) {
			promote()
		}
	}
}

func noopCaptureDone() {}

// isWriteSQL reports whether sql begins with a SQLite verb that takes (or
// attempts to take) the writer lock. Used as the secondary signal for lazy
// writer-slot promotion of top-level sqlitex.Save scopes: the primary
// signal is the before/after delta of conn.Changes() around the Exec, and
// this catches the cases where the delta is zero — DDL/maintenance, and
// DML that ran but affected zero rows (e.g. INSERT ... ON CONFLICT DO
// NOTHING that conflicted, UPDATE with no matching WHERE clause). Even
// when zero rows changed, those statements briefly acquired the writer
// lock, which is what matters for writer-health accounting.
//
// A leading WITH CTE that ends in a write isn't matched here — those still
// move conn.Changes() and are caught by the primary delta signal.
func isWriteSQL(sql string) bool {
	i := 0
	for i < len(sql) && (sql[i] == ' ' || sql[i] == '\t' || sql[i] == '\n' || sql[i] == '\r') {
		i++
	}
	rest := sql[i:]
	for _, v := range writeVerbs {
		if len(rest) < len(v) {
			continue
		}
		if !strings.EqualFold(rest[:len(v)], v) {
			continue
		}
		if len(rest) == len(v) {
			return true
		}
		next := rest[len(v)]
		// Verb must be followed by whitespace, ';' or '(' to be a word.
		if next == ' ' || next == '\t' || next == '\n' || next == '\r' || next == ';' || next == '(' {
			return true
		}
	}
	return false
}

var writeVerbs = []string{
	// DML — these usually move conn.Changes(), but no-op variants (ON
	// CONFLICT DO NOTHING, WHERE-no-match) don't, so we still need the
	// prefix match as a backstop.
	"INSERT", "UPDATE", "DELETE", "REPLACE",
	// DDL and maintenance — these take the writer lock and never move
	// conn.Changes(), so the prefix match is the only signal.
	"CREATE", "DROP", "ALTER", "ATTACH", "DETACH",
	"VACUUM", "REINDEX", "ANALYZE", "TRUNCATE",
}

// collapseSQL strips surrounding whitespace and collapses runs of internal
// whitespace so the captured statements render compactly in the debug page.
func collapseSQL(q string) string {
	q = strings.TrimSpace(q)
	if !strings.ContainsAny(q, "\n\t") && !strings.Contains(q, "  ") {
		return q
	}
	var b strings.Builder
	b.Grow(len(q))
	space := false
	for _, r := range q {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			if !space {
				b.WriteByte(' ')
				space = true
			}
			continue
		}
		b.WriteRune(r)
		space = false
	}
	return b.String()
}

// formatArgs renders bind args into a compact display string and bounds the
// total length. Byte slices are summarised by length to avoid retaining large
// blob payloads on the page.
func formatArgs(args []interface{}) string {
	if len(args) == 0 {
		return ""
	}
	// Special case the named-args map[string]any form that BindArgs supports.
	if len(args) == 1 {
		if m, ok := args[0].(map[string]any); ok {
			var b strings.Builder
			b.WriteByte('{')
			first := true
			for k, v := range m {
				if !first {
					b.WriteString(", ")
				}
				first = false
				b.WriteString(k)
				b.WriteByte('=')
				appendArg(&b, v)
				if b.Len() >= captureArgsCap {
					b.WriteString("…")
					break
				}
			}
			b.WriteByte('}')
			return truncate(b.String(), captureArgsCap)
		}
	}
	var b strings.Builder
	b.WriteByte('[')
	for i, a := range args {
		if i > 0 {
			b.WriteString(", ")
		}
		appendArg(&b, a)
		if b.Len() >= captureArgsCap {
			b.WriteString("…")
			break
		}
	}
	b.WriteByte(']')
	return truncate(b.String(), captureArgsCap)
}

func appendArg(b *strings.Builder, a interface{}) {
	switch v := a.(type) {
	case nil:
		b.WriteString("nil")
	case []byte:
		fmt.Fprintf(b, "[]byte(%d)", len(v))
	case string:
		if len(v) > 60 {
			fmt.Fprintf(b, "%q…", v[:60])
		} else {
			fmt.Fprintf(b, "%q", v)
		}
	default:
		fmt.Fprintf(b, "%v", a)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// activeTx is one currently in-flight write tx.
type activeTx struct {
	ID        uint64
	Caller    string
	StartedAt time.Time
}

// txTracker owns the in-memory state surfaced to /debug/sqlite.
type txTracker struct {
	mu sync.Mutex

	// Per-caller cumulative stats (and the cardinality cap state).
	callers map[string]*callerStats

	// Top-K-by-hold buffers of the slowest operations seen since startup,
	// split by kind. Writes (everything except savepoint_ro) and reads
	// (savepoint_ro) have separate caps so a steady stream of slow reads
	// can't displace a rare slow write, and vice versa. New samples
	// displace the smallest-hold entry within the same ring when it's
	// full, so an old outlier survives unless something even slower
	// arrives in the same kind.
	recentWrite []txSample
	recentRead  []txSample

	// In-flight transactions, keyed by a monotonic id.
	active map[uint64]activeTx
	nextID atomic.Uint64
}

var tracker = newTxTracker()

func newTxTracker() *txTracker {
	return &txTracker{
		callers: make(map[string]*callerStats),
		active:  make(map[uint64]activeTx),
	}
}

// normalizeCaller caps cardinality to maxCallerLabels. Callers beyond the cap
// are bucketed under "other" so a buggy resolver can never explode the
// Prometheus series count.
func (t *txTracker) normalizeCaller(c string) string {
	if c == "" {
		return "unknown"
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.callers[c]; ok {
		return c
	}
	if len(t.callers) >= maxCallerLabels {
		return "other"
	}
	t.callers[c] = &callerStats{}
	return c
}

func (t *txTracker) startActive(caller string) uint64 {
	id := t.nextID.Add(1)
	t.mu.Lock()
	t.active[id] = activeTx{ID: id, Caller: caller, StartedAt: time.Now()}
	t.mu.Unlock()
	mInFlight.WithLabelValues(caller).Inc()
	return id
}

func (t *txTracker) endActive(id uint64, caller string) {
	t.mu.Lock()
	delete(t.active, id)
	t.mu.Unlock()
	mInFlight.WithLabelValues(caller).Dec()
}

func (t *txTracker) recordTx(caller string, beginWait, hold time.Duration, outcome txOutcome, stmts []capturedStmt, heldBy []activeTx) {
	// Prometheus mTxDuration is the WRITE-tx histogram by name. Emitting
	// read-only Saves under it would be a category error and would inflate
	// every dashboard that reads it. The per-caller writetx_begin_wait and
	// begin_busy metrics are similarly write-scoped. Reads still flow into
	// the in-memory tracker below (driving the read-side per-caller table
	// and the unified slowest-ops table on /debug/sqlite), they just stay
	// out of the writer-scoped Prometheus surface.
	if outcome != outcomeSavepointReadOnly {
		mTxDuration.WithLabelValues(caller, string(outcome)).Observe(hold.Seconds())
		mBeginWait.WithLabelValues(caller).Observe(beginWait.Seconds())
		if outcome == outcomeBeginBusy {
			mBeginBusy.WithLabelValues(caller).Inc()
		}
	}

	t.mu.Lock()
	st, ok := t.callers[caller]
	if !ok {
		st = &callerStats{}
		t.callers[caller] = st
	}
	t.mu.Unlock()
	st.record(hold, beginWait, outcome)

	if hold >= slowThreshold || outcome == outcomeBeginBusy {
		sample := txSample{
			When:      time.Now(),
			Caller:    caller,
			Hold:      hold,
			BeginWait: beginWait,
			Outcome:   outcome,
			Stmts:     stmts,
			HeldBy:    heldBy,
		}
		t.mu.Lock()
		if outcome == outcomeSavepointReadOnly {
			t.recentRead = insertTopK(t.recentRead, sample, recentReadCap)
		} else {
			t.recentWrite = insertTopK(t.recentWrite, sample, recentWriteCap)
		}
		t.mu.Unlock()
	}
}

// insertTopK maintains buf as a top-K-by-hold buffer bounded by cap. New
// samples displace the smallest-hold entry once full, so an old outlier
// survives unless something even slower arrives in the same kind.
// begin_busy rows have hold == beginWait (typically ~10 s) and so win
// the comparison naturally — no special handling needed.
//
// Linear scan for the smallest is fine here: cap is at most a few hundred
// and slow events are rare, so per-event cost is negligible. A heap would
// trade simplicity for no measurable win.
func insertTopK(buf []txSample, sample txSample, cap int) []txSample {
	if len(buf) < cap {
		return append(buf, sample)
	}
	minIdx := 0
	for i := 1; i < len(buf); i++ {
		if buf[i].Hold < buf[minIdx].Hold {
			minIdx = i
		}
	}
	if sample.Hold > buf[minIdx].Hold {
		buf[minIdx] = sample
	}
	return buf
}

// snapshotActive returns a copy of the currently-held write transactions.
// Used at the moment of a begin_busy failure so the page can show exactly
// who was on the writer slot while this caller waited it out.
func (t *txTracker) snapshotActive() []activeTx {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.active) == 0 {
		return nil
	}
	out := make([]activeTx, 0, len(t.active))
	for _, a := range t.active {
		out = append(out, a)
	}
	return out
}

// snapshot returns a stable copy of the tracker state for rendering. The
// per-caller view is split into WriteCallers (anything that interacted
// with the writer slot, including BUSY/INTERRUPT attempts) and ReadCallers
// (top-level Save scopes that never wrote). The same caller name can
// appear in both maps if it has both kinds of activity.
//
// RecentWrite and RecentRead are independent top-K-by-hold buffers (cap
// recentWriteCap and recentReadCap respectively), so a steady stream of
// slow reads cannot evict a rare slow write or vice versa.
type trackerSnapshot struct {
	WriteCallers map[string]writeCallerSnapshot
	ReadCallers  map[string]readCallerSnapshot
	RecentWrite  []txSample
	RecentRead   []txSample
	Active       []activeTx
}

// writeCallerSnapshot mirrors the original per-caller stats shape, minus
// the now-removed Max column.
type writeCallerSnapshot struct {
	Count     uint64
	Commits   uint64
	Rollbacks uint64
	BusyCount uint64
	HoldP10Ms float64
	HoldP50Ms float64
	HoldP90Ms float64
	HoldP99Ms float64
	WaitP10Ms float64
	WaitP50Ms float64
	WaitP90Ms float64
	WaitP99Ms float64
}

// readCallerSnapshot is the read-only-Save counterpart. Reads never own
// the writer slot, so wait/busy/commits/rollbacks have no meaning here.
type readCallerSnapshot struct {
	Count     uint64
	HoldP10Ms float64
	HoldP50Ms float64
	HoldP90Ms float64
	HoldP99Ms float64
}

func (t *txTracker) snapshot() trackerSnapshot {
	t.mu.Lock()
	callerNames := make([]string, 0, len(t.callers))
	for name := range t.callers {
		callerNames = append(callerNames, name)
	}
	recentWrite := make([]txSample, len(t.recentWrite))
	copy(recentWrite, t.recentWrite)
	recentRead := make([]txSample, len(t.recentRead))
	copy(recentRead, t.recentRead)
	active := make([]activeTx, 0, len(t.active))
	for _, a := range t.active {
		active = append(active, a)
	}
	t.mu.Unlock()

	out := trackerSnapshot{
		WriteCallers: make(map[string]writeCallerSnapshot, len(callerNames)),
		ReadCallers:  make(map[string]readCallerSnapshot, len(callerNames)),
		RecentWrite:  recentWrite,
		RecentRead:   recentRead,
		Active:       active,
	}

	for _, name := range callerNames {
		t.mu.Lock()
		st := t.callers[name]
		t.mu.Unlock()
		if st == nil {
			continue
		}
		st.mu.Lock()
		writeCount := st.write.count
		commits := st.write.commits
		rollbacks := st.write.rollbacks
		busy := st.write.busyCount
		readCount := st.read.count
		st.mu.Unlock()

		// Callers registered via normalizeCaller but with no recorded
		// activity at all are skipped — they'd render as blank rows of
		// zeros and dilute whichever table the user is scanning.
		if writeCount > 0 {
			holdP10, holdP50, holdP90, holdP99 := st.writeHoldPercentilesMs()
			waitP10, waitP50, waitP90, waitP99 := st.writeWaitPercentilesMs()
			out.WriteCallers[name] = writeCallerSnapshot{
				Count:     writeCount,
				Commits:   commits,
				Rollbacks: rollbacks,
				BusyCount: busy,
				HoldP10Ms: holdP10,
				HoldP50Ms: holdP50,
				HoldP90Ms: holdP90,
				HoldP99Ms: holdP99,
				WaitP10Ms: waitP10,
				WaitP50Ms: waitP50,
				WaitP90Ms: waitP90,
				WaitP99Ms: waitP99,
			}
		}
		if readCount > 0 {
			rHoldP10, rHoldP50, rHoldP90, rHoldP99 := st.readHoldPercentilesMs()
			out.ReadCallers[name] = readCallerSnapshot{
				Count:     readCount,
				HoldP10Ms: rHoldP10,
				HoldP50Ms: rHoldP50,
				HoldP90Ms: rHoldP90,
				HoldP99Ms: rHoldP99,
			}
		}
	}
	return out
}

// resolveCaller walks up the stack and returns the first frame outside this
// package. Result is "pkg.Func" formatted, e.g. "blob.(*Index).PutMany".
//
// Hot-path optimisation: the raw PC slice is cached so once a call site is
// seen, subsequent invocations skip runtime.CallersFrames symbol resolution
// entirely. Symbol resolution is by far the dominant cost of the lookup;
// runtime.Callers itself is a cheap single call. With this cache, the steady
// state cost of resolveCaller is one runtime.Callers + one map load.
const pcKeyLen = 4

type pcKey [pcKeyLen]uintptr

var (
	pcStackCache sync.Map // pcKey      -> string (whole-stack short-circuit)
	pcFrameCache sync.Map // uintptr PC -> string ("" = sqlitex frame, else caller name)
)

func resolveCaller() string {
	var pcs [pcKeyLen]uintptr
	// Skip resolveCaller itself + the WithTx frame that called us.
	n := runtime.Callers(2, pcs[:])
	if n == 0 {
		return "unknown"
	}

	// Fast path: hit the whole-stack cache.
	if v, ok := pcStackCache.Load(pcs); ok {
		return v.(string)
	}

	// Slow path: walk frames once, populate caches.
	frames := runtime.CallersFrames(pcs[:n])
	for {
		frame, more := frames.Next()
		if frame.PC == 0 {
			if !more {
				break
			}
			continue
		}
		// Per-PC cache lets us re-use symbol resolution across different
		// stacks that share a frame.
		var name string
		if v, ok := pcFrameCache.Load(frame.PC); ok {
			name = v.(string)
		} else {
			if isSqlitexFrame(frame.Function) {
				name = "" // marker: sqlitex frame, keep walking.
			} else {
				name = formatCaller(frame.Function)
			}
			pcFrameCache.Store(frame.PC, name)
		}
		if name != "" {
			pcStackCache.Store(pcs, name)
			return name
		}
		if !more {
			break
		}
	}
	pcStackCache.Store(pcs, "unknown")
	return "unknown"
}

func isSqlitexFrame(fn string) bool {
	return strings.Contains(fn, "util/sqlite/sqlitex.") ||
		strings.Contains(fn, "util/sqlite/sqlitex/") ||
		// runtime functions can show up when the stack is mid-defer.
		strings.HasPrefix(fn, "runtime.")
}

// formatCaller turns a fully-qualified function name like
// "seed/backend/blob.(*Index).PutMany" into "blob.(*Index).PutMany".
func formatCaller(fn string) string {
	if i := strings.LastIndex(fn, "/"); i >= 0 {
		return fn[i+1:]
	}
	return fn
}
