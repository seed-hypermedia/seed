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
	recentSlowCap   = 200
)

// txOutcome is the "outcome" label on the duration histogram.
type txOutcome string

const (
	outcomeCommit    txOutcome = "commit"
	outcomeRollback  txOutcome = "rollback"
	outcomeBeginBusy txOutcome = "begin_busy"
	outcomeSavepoint txOutcome = "savepoint"
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

// callerStats accumulates per-caller stats for the debug page.
// Percentiles are computed from a fixed-size reservoir of samples; the
// reservoir is cheap memory (a few KB per caller) and we only have ~20-30
// distinct callers in practice.
type callerStats struct {
	mu        sync.Mutex
	count     uint64
	busyCount uint64
	maxHold   time.Duration
	holdSum   time.Duration
	reservoir []float64 // hold durations in ms; bounded
	commits   uint64
	rollbacks uint64
}

const reservoirCap = 1024

func (s *callerStats) record(hold time.Duration, outcome txOutcome) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.count++
	s.holdSum += hold
	if hold > s.maxHold {
		s.maxHold = hold
	}
	switch outcome {
	case outcomeCommit:
		s.commits++
	case outcomeRollback:
		s.rollbacks++
	case outcomeBeginBusy:
		s.busyCount++
	}
	ms := float64(hold) / float64(time.Millisecond)
	if len(s.reservoir) < reservoirCap {
		s.reservoir = append(s.reservoir, ms)
	} else {
		// Simple FIFO replacement instead of true reservoir sampling.
		// We care more about recent behaviour than perfect uniformity.
		s.reservoir[s.count%reservoirCap] = ms
	}
}

// percentilesMs returns p10, p50, p90, p99 of recorded hold durations in ms
// using the nearest-rank method. With nearest-rank, p99 of any sample of size
// n is the observation at index ceil(p*n)-1, so for n<100 the p99 equals the
// max — which is what the user expects when only a handful of samples exist.
// The max and mean are intentionally not exposed because they're trivial to
// derive from these percentiles plus the call count.
func (s *callerStats) percentilesMs() (p10, p50, p90, p99 float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.reservoir) == 0 {
		return 0, 0, 0, 0
	}
	buf := make([]float64, len(s.reservoir))
	copy(buf, s.reservoir)
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
}

// capturedStmt is one statement executed inside an instrumented tx.
// Args are stored as a single rendered string with each arg truncated to
// keep the buffer bounded and avoid keeping large blobs alive.
type capturedStmt struct {
	SQL  string
	Args string
}

// txCapture is the buffer attached to a *sqlite.Conn for the lifetime of a
// WithTx body. Exec/ExecTransient append to it via captureExec; if no buffer
// is attached for the conn the capture path is a single sync.Map load that
// short-circuits to no-op.
type txCapture struct {
	mu    sync.Mutex
	stmts []capturedStmt
}

const (
	captureStmtCap = 50  // max statements retained per tx
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

// captureExec appends one statement to the active tx buffer for conn, if any.
// Called from Exec / ExecTransient. The fast path is a single sync.Map load
// that returns immediately when no capture is active.
func captureExec(conn *sqlite.Conn, sql string, args []interface{}) {
	v, ok := captureBufs.Load(conn)
	if !ok {
		return
	}
	c := v.(*txCapture)
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.stmts) >= captureStmtCap {
		return
	}
	c.stmts = append(c.stmts, capturedStmt{
		SQL:  truncate(collapseSQL(sql), captureSQLCap),
		Args: formatArgs(args),
	})
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

	// Bounded ring buffer of recent slow transactions.
	recent    []txSample
	recentIdx int

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

func (t *txTracker) recordTx(caller string, beginWait, hold time.Duration, outcome txOutcome, stmts []capturedStmt) {
	mTxDuration.WithLabelValues(caller, string(outcome)).Observe(hold.Seconds())
	mBeginWait.WithLabelValues(caller).Observe(beginWait.Seconds())
	if outcome == outcomeBeginBusy {
		mBeginBusy.WithLabelValues(caller).Inc()
	}

	t.mu.Lock()
	st, ok := t.callers[caller]
	if !ok {
		st = &callerStats{}
		t.callers[caller] = st
	}
	t.mu.Unlock()
	st.record(hold, outcome)

	if hold >= slowThreshold || outcome == outcomeBeginBusy {
		t.mu.Lock()
		sample := txSample{
			When:      time.Now(),
			Caller:    caller,
			Hold:      hold,
			BeginWait: beginWait,
			Outcome:   outcome,
			Stmts:     stmts,
		}
		if len(t.recent) < recentSlowCap {
			t.recent = append(t.recent, sample)
		} else {
			t.recent[t.recentIdx] = sample
			t.recentIdx = (t.recentIdx + 1) % recentSlowCap
		}
		t.mu.Unlock()
	}
}

// snapshot returns a stable copy of the tracker state for rendering.
type trackerSnapshot struct {
	Callers map[string]callerSnapshot
	Recent  []txSample
	Active  []activeTx
}

type callerSnapshot struct {
	Count     uint64
	Commits   uint64
	Rollbacks uint64
	BusyCount uint64
	P10Ms     float64
	P50Ms     float64
	P90Ms     float64
	P99Ms     float64
}

func (t *txTracker) snapshot() trackerSnapshot {
	t.mu.Lock()
	callerNames := make([]string, 0, len(t.callers))
	for name := range t.callers {
		callerNames = append(callerNames, name)
	}
	recent := make([]txSample, len(t.recent))
	copy(recent, t.recent)
	active := make([]activeTx, 0, len(t.active))
	for _, a := range t.active {
		active = append(active, a)
	}
	t.mu.Unlock()

	out := trackerSnapshot{
		Callers: make(map[string]callerSnapshot, len(callerNames)),
		Recent:  recent,
		Active:  active,
	}

	for _, name := range callerNames {
		t.mu.Lock()
		st := t.callers[name]
		t.mu.Unlock()
		if st == nil {
			continue
		}
		st.mu.Lock()
		count := st.count
		commits := st.commits
		rollbacks := st.rollbacks
		busy := st.busyCount
		st.mu.Unlock()
		p10, p50, p90, p99 := st.percentilesMs()
		out.Callers[name] = callerSnapshot{
			Count:     count,
			Commits:   commits,
			Rollbacks: rollbacks,
			BusyCount: busy,
			P10Ms:     p10,
			P50Ms:     p50,
			P90Ms:     p90,
			P99Ms:     p99,
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
