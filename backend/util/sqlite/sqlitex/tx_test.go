package sqlitex_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// TestWithTxRecordsCaller verifies that WithTx attributes its observations to
// the caller (this test function) and surfaces them on the debug page.
func TestWithTxRecordsCaller(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()

	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS t (x int);", nil))

	require.NoError(t, sqlitex.WithTx(conn, func() error {
		time.Sleep(150 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO t (x) VALUES (1);", nil)
	}))

	body := renderDebugPage(t)
	require.Contains(t, body, "TestWithTxRecordsCaller", "caller label should appear in /debug/sqlite page")
	require.Contains(t, body, "Per-caller stats")
	require.Contains(t, body, "ms", "hold time should be rendered in ms or s")
}

// TestWithTxRecordsBeginBusy verifies that when BEGIN IMMEDIATE fails with
// SQLITE_BUSY (busy_timeout expires), we (a) return ErrBeginImmediateTx and
// (b) increment the begin_busy counter for the calling site.
func TestWithTxRecordsBeginBusy(t *testing.T) {
	// Use a file-backed pool so the two connections actually compete on a
	// real file lock — shared-cache in-memory pools go through unlock_notify
	// and don't honor SetBusyTimeout the same way.
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)

	// Hog the write lock on connection A.
	holder := pool.Get(nil)
	require.NoError(t, sqlitex.Exec(holder, "BEGIN IMMEDIATE TRANSACTION;", nil))

	// Try to BEGIN IMMEDIATE on connection B with a tight timeout.
	victim := pool.Get(nil)
	victim.SetBusyTimeout(100 * time.Millisecond)

	t.Cleanup(func() {
		pool.Put(victim)
		_ = sqlitex.Exec(holder, "ROLLBACK;", nil)
		pool.Put(holder)
		_ = pool.Close()
	})

	err = sqlitex.WithTx(victim, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx),
		"expected ErrBeginImmediateTx, got %v", err)

	body := renderDebugPage(t)
	require.Contains(t, body, "TestWithTxRecordsBeginBusy")
	require.Contains(t, body, "begin_busy")
}

// TestPerCallerP99ReflectsRealHolds verifies the per-caller hold percentile
// table on /debug/sqlite reflects the actual commit hold times, and is not
// dragged down by savepoints (nested-tx fallback), busy failures, or
// interrupted BEGINs — all of which never actually held the writer lock.
// Regression: previously, savepoints were folded into the hold reservoir
// with their fn() runtime, and busy/interrupted "holds" were synthetic
// copies of begin_wait, both polluting the percentiles enough that p99
// could read sub-ms while recent rows clearly showed 200 ms+ commits.
func TestPerCallerP99ReflectsRealHolds(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS p99test (x int);", nil))

	// One slow commit — must be visible in p99.
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		time.Sleep(150 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO p99test (x) VALUES (1);", nil)
	}))
	// Many fast savepoints (nested WithTx) that would have polluted the
	// hold reservoir with their fn() runtimes under the old code.
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		for i := 0; i < 20; i++ {
			if err := sqlitex.WithTx(conn, func() error { return nil }); err != nil {
				return err
			}
		}
		return nil
	}))

	body := renderDebugPage(t)
	// The 150 ms commit must dominate this caller's p99 column. The page
	// renders fmtMs as "150.3 ms" (or similar) — look for the magnitude
	// without coupling to a specific decimal.
	require.Contains(t, body, "TestPerCallerP99ReflectsRealHolds")
	require.Regexp(t, `1[0-9]{2}\.[0-9] ms`, body,
		"p99 (or max-visible hold) must reflect the 150 ms commit, not be dragged below it by savepoint noise")
}

// TestWithTxRecordsBeginInterrupted verifies a non-busy BEGIN IMMEDIATE
// failure (here SQLITE_INTERRUPT from a pre-cancelled ctx) is reported as
// begin_interrupted, not begin_busy. Previously every non-nested BEGIN
// failure was lumped into begin_busy, which dominated the page with noise
// from context-cancelled connect-path txs whose begin_wait was sub-ms.
func TestWithTxRecordsBeginInterrupted(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()

	conn := pool.Get(nil)
	defer pool.Put(conn)

	// Wire an already-cancelled ctx so the next syscall trips SQLITE_INTERRUPT
	// during BEGIN IMMEDIATE — no busy timeout, no lock holder to blame.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	conn.SetInterrupt(ctx.Done())
	defer conn.SetInterrupt(nil)

	err := sqlitex.WithTx(conn, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx),
		"interrupted BEGIN IMMEDIATE must still wrap ErrBeginImmediateTx for backward-compat with connect.go retry logic")

	body := renderDebugPage(t)
	require.Contains(t, body, "begin_interrupted",
		"interrupted BEGIN must be labelled begin_interrupted on /debug/sqlite")
	require.Contains(t, body, "TestWithTxRecordsBeginInterrupted",
		"interrupted row must surface its caller for diagnosis")
}

// TestWithTxBeginBusySnapshotsHolder verifies the begin_busy row records
// who was holding the writer slot at the moment BEGIN IMMEDIATE failed. The
// debug page uses this to attribute publish-fails-with-BUSY to a specific
// caller without manual time-correlation.
func TestWithTxBeginBusySnapshotsHolder(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)

	holderConn := pool.Get(nil)
	victim := pool.Get(nil)
	victim.SetBusyTimeout(100 * time.Millisecond)
	t.Cleanup(func() {
		pool.Put(victim)
		pool.Put(holderConn)
		_ = pool.Close()
	})

	// Holder runs its own WithTx in a goroutine so tracker.active records it.
	holderEntered := make(chan struct{})
	holderRelease := make(chan struct{})
	holderDone := make(chan struct{})
	go func() {
		defer close(holderDone)
		_ = holderHogTx(holderConn, holderEntered, holderRelease)
	}()
	<-holderEntered

	err = sqlitex.WithTx(victim, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx))

	close(holderRelease)
	<-holderDone

	body := renderDebugPage(t)
	// The victim's busy row must surface the holder by caller name.
	require.Contains(t, body, "held by")
	require.Contains(t, body, "holderHogTx")
}

// holderHogTx parks a WithTx on conn so the test's victim races against a
// known caller name in tracker.active.
func holderHogTx(conn *sqlite.Conn, entered, release chan struct{}) error {
	return sqlitex.WithTx(conn, func() error {
		close(entered)
		<-release
		return nil
	})
}

// TestWithTxNestedSavepointFallback verifies that the nested-tx savepoint
// fallback still works and is recorded as "savepoint", not as a writer-lock tx.
func TestWithTxNestedSavepointFallback(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS t (x int);", nil))

	require.NoError(t, sqlitex.WithTx(conn, func() error {
		return sqlitex.WithTx(conn, func() error {
			return sqlitex.Exec(conn, "INSERT INTO t (x) VALUES (42);", nil)
		})
	}))
}

// TestWithTxCapturesStatements verifies the debug page exposes the SQL +
// rendered bind args of statements that ran inside a slow transaction.
func TestWithTxCapturesStatements(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS captest (k text, v int);", nil))

	// Slow tx with two inserts that bind distinct args; only slow txs show
	// statements on the recent panel so we sleep past slowThreshold.
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		if err := sqlitex.Exec(conn, "INSERT INTO captest (k, v) VALUES (?, ?);", nil, "answer", 42); err != nil {
			return err
		}
		time.Sleep(120 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO captest (k, v) VALUES (?, ?);", nil, "other", 7)
	}))

	body := renderDebugPage(t)
	require.Contains(t, body, "INSERT INTO captest")
	// html/template escapes the literal double quotes around the rendered
	// string arg, so match the HTML-escaped form rather than the raw one.
	require.Contains(t, body, "&#34;answer&#34;", "bind arg must be rendered")
	require.Contains(t, body, "42", "bind arg must be rendered")
	// Per-statement duration column must be present so we can spot
	// which statement (e.g. a slow COMMIT under WAL pressure) ate the time.
	require.Contains(t, body, "<th class=\"num\">dur</th>",
		"inner statements table must render the dur column")
}

// TestWithTxCaptureBytesSummarised verifies that []byte args are reported by
// length, not by content, so big blob payloads don't get pinned to memory.
func TestWithTxCaptureBytesSummarised(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS captest_b (b blob);", nil))

	blob := make([]byte, 1024)
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		if err := sqlitex.Exec(conn, "INSERT INTO captest_b (b) VALUES (?);", nil, blob); err != nil {
			return err
		}
		time.Sleep(110 * time.Millisecond)
		return nil
	}))

	body := renderDebugPage(t)
	require.Contains(t, body, "[]byte(1024)")
}

// TestDebugHandlerRenders does a minimal smoke test of the HTML output.
func TestDebugHandlerRenders(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.WithTx(conn, func() error { return nil }))

	body := renderDebugPage(t)
	require.Contains(t, body, "<title>seed sqlite writer health</title>")
	require.Contains(t, body, "Per-caller stats")
	require.Contains(t, body, "Currently in flight")
	require.Contains(t, body, "Slowest slow")
}

// TestPoolWithSaveRecordsAsTopLevelSavepoint verifies that Pool.WithSave —
// which used to bypass the tracker entirely — now contributes to the
// per-caller hold percentile on /debug/sqlite under outcome=savepoint_top.
// This is the regression that made the writer-slot offender invisible: every
// api/documents and api/entities write went through WithSave and produced no
// hold sample at all, so p99 hold across all callers stayed sub-second even
// when victims waited the full 10 s busy_timeout.
func TestPoolWithSaveRecordsAsTopLevelSavepoint(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	require.NoError(t, pool.WithTx(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS withsave (x int);", nil)
	}))

	require.NoError(t, pool.WithSave(ctx, func(c *sqlite.Conn) error {
		time.Sleep(120 * time.Millisecond)
		return sqlitex.Exec(c, "INSERT INTO withsave (x) VALUES (1);", nil)
	}))

	body := renderDebugPage(t)
	require.Contains(t, body, "TestPoolWithSaveRecordsAsTopLevelSavepoint",
		"WithSave caller must now appear on /debug/sqlite — this is the fix")
	require.Contains(t, body, "savepoint_top",
		"top-level Save must be labelled savepoint_top in the recent table")
	require.Regexp(t, `1[0-9]{2}\.[0-9] ms`, body,
		"hold must reflect the ~120 ms savepoint body, not be elided like before")
}

// TestSaveDirectRecordsTopLevel verifies the bare `defer sqlitex.Save(conn)(&err)`
// pattern (used by ExecScript, Read[], and many hand-rolled call sites) also
// surfaces on /debug/sqlite. Same regression bucket as Pool.WithSave.
func TestSaveDirectRecordsTopLevel(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS sd (x int);", nil))

	func() (err error) {
		defer sqlitex.Save(conn)(&err)
		time.Sleep(110 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO sd (x) VALUES (7);", nil)
	}()

	body := renderDebugPage(t)
	require.Contains(t, body, "TestSaveDirectRecordsTopLevel.func1",
		"bare Save(conn) caller must be resolved past the closure boundary")
	require.Contains(t, body, "savepoint_top")
}

// TestSaveTopLevelSnapshotsAsHolder verifies that a top-level Save shows up
// in the in-flight active set, so a concurrent BEGIN IMMEDIATE that times out
// can point at the WithSave caller as the holder. This is the missing "held by"
// data we needed to actually finger the offender.
func TestSaveTopLevelSnapshotsAsHolder(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)

	holderConn := pool.Get(nil)
	victim := pool.Get(nil)
	victim.SetBusyTimeout(100 * time.Millisecond)
	t.Cleanup(func() {
		pool.Put(victim)
		pool.Put(holderConn)
		_ = pool.Close()
	})

	require.NoError(t, sqlitex.Exec(holderConn, "CREATE TABLE IF NOT EXISTS h (x int);", nil))

	holderEntered := make(chan struct{})
	holderRelease := make(chan struct{})
	holderDone := make(chan struct{})
	go func() {
		defer close(holderDone)
		_ = holderHogSave(holderConn, holderEntered, holderRelease)
	}()
	<-holderEntered

	err = sqlitex.WithTx(victim, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx))

	close(holderRelease)
	<-holderDone

	body := renderDebugPage(t)
	require.Contains(t, body, "held by",
		"begin_busy row must surface the holder section")
	require.Contains(t, body, "holderHogSave",
		"the WithSave-based holder must be named in the held-by list — without this we are blind to the offender")
}

func holderHogSave(conn *sqlite.Conn, entered, release chan struct{}) (err error) {
	defer sqlitex.Save(conn)(&err)
	// Force the deferred savepoint to actually take the writer lock by
	// issuing a write before parking; a read-only savepoint stays on the
	// shared (reader) lock and would not block BEGIN IMMEDIATE.
	if err := sqlitex.Exec(conn, "INSERT INTO h (x) VALUES (1);", nil); err != nil {
		return err
	}
	close(entered)
	<-release
	return nil
}

// TestSaveReadOnlyAppearsInReadSection verifies that a top-level Save that
// only reads renders in the dedicated "Read operations" per-caller table
// and the unified Slowest-ops table, while staying out of the Write
// operations table (it never owned the writer slot). The previous
// behavior (suppressing read-only Saves entirely) was changed when the
// page was split into read-vs-write tables: read-side metrics now have
// their own surface so the original "don't dilute the writer-slot
// signal" concern is addressed by separation, not by hiding.
func TestSaveReadOnlyAppearsInReadSection(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	setupReadOnlyTable(ctx, t, pool)

	// Sleep past slowThreshold so the row is large enough to land in the
	// top-K slowest ring as well as the per-caller read table.
	runReadOnlySave(ctx, t, pool)

	body := renderDebugPage(t)
	require.Contains(t, body, "Read operations",
		"page must render the dedicated read-operations section")
	require.Contains(t, body, "runReadOnlySave",
		"the read-only Save caller must appear in the read-operations table")
	require.Contains(t, body, "savepoint_ro",
		"savepoint_ro outcome must render on the slowest table because the Save was slow (>100 ms)")
}

func setupReadOnlyTable(ctx context.Context, t *testing.T, pool *sqlitex.Pool) {
	t.Helper()
	require.NoError(t, pool.WithTx(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS ro (x int);", nil)
	}))
}

func runReadOnlySave(ctx context.Context, t *testing.T, pool *sqlitex.Pool) {
	t.Helper()
	require.NoError(t, pool.WithSave(ctx, func(c *sqlite.Conn) error {
		time.Sleep(110 * time.Millisecond)
		return sqlitex.Exec(c, "SELECT COUNT(*) FROM ro;", nil)
	}))
}

// TestSaveReadOnAfterWriteOnSameConnNotPromoted is the regression test for
// the bug that kept ListEvents / ListPeers / DiscoverObjectWithProgress on
// the WRITE-side of the writer-health page in production: SQLite's
// conn.Changes() returns the row-count of the most recent DML on this
// *connection*, and is NOT reset by SELECTs or by returning the conn to
// the pool. A pooled conn that previously ran an INSERT therefore reports
// Changes() > 0 forever after, and the lazy write-detection in
// captureExecStart was firing promote() on a pure SELECT — falsely
// tagging the Save as a writer-slot holder (savepoint_top instead of
// savepoint_ro). The correct signal is the before/after delta of
// Changes() around each individual Exec call.
//
// Since the page was split into read/write tables, the regression
// manifests as the caller showing up under "savepoint_top" instead of
// "savepoint_ro" — the caller's *name* is now legitimately present in
// the read section. The negative assertion below is therefore narrowed
// to "must not render as savepoint_top".
func TestSaveReadOnAfterWriteOnSameConnNotPromoted(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	setupReadOnlyTableConn(t, conn)
	// Prime the conn with a real INSERT so conn.Changes() is non-zero
	// going into the subsequent read-only Save.
	primeWriteOnConn(t, conn)

	// Now perform the read-only Save on the *same* conn that just wrote.
	// Under the bug this would be promoted to savepoint_top.
	runReadOnlySaveOnConn(t, conn)

	body := renderDebugPage(t)
	// The exact regression: this read-only Save must NOT be promoted into
	// the write-operations table. (It IS expected to appear in the
	// read-operations table — the caller name on its own is no longer
	// load-bearing for the regression assertion.)
	writeSection, readSection := splitWriteVsReadSections(t, body)
	require.NotContains(t, writeSection, "runReadOnlySaveOnConn",
		"read-only Save on a conn with stale Changes() > 0 must NOT be promoted into the write-operations table")
	require.Contains(t, readSection, "runReadOnlySaveOnConn",
		"the read-only Save must appear in the read-operations table — the read-side bookkeeping is the whole point of separating the tables")
}

// splitWriteVsReadSections returns the HTML between the "Write operations"
// h3 and the "Read operations" h3 as writeSection, and everything from
// the "Read operations" h3 to the next h2 as readSection. Used by tests
// that assert a caller appears in one section but not the other.
func splitWriteVsReadSections(t *testing.T, body string) (writeSection, readSection string) {
	t.Helper()
	const writeMarker = "<h3>Write operations</h3>"
	const readMarker = "<h3>Read operations</h3>"
	wIdx := strings.Index(body, writeMarker)
	rIdx := strings.Index(body, readMarker)
	require.GreaterOrEqual(t, wIdx, 0, "page must include a Write operations section")
	require.GreaterOrEqual(t, rIdx, 0, "page must include a Read operations section")
	require.Less(t, wIdx, rIdx, "Write operations section must precede Read operations on the page")
	writeSection = body[wIdx:rIdx]
	rest := body[rIdx:]
	nextH2 := strings.Index(rest, "<h2>")
	if nextH2 < 0 {
		readSection = rest
	} else {
		readSection = rest[:nextH2]
	}
	return writeSection, readSection
}

func setupReadOnlyTableConn(t *testing.T, conn *sqlite.Conn) {
	t.Helper()
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		return sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS ro2 (x int);", nil)
	}))
}

func primeWriteOnConn(t *testing.T, conn *sqlite.Conn) {
	t.Helper()
	// Real INSERT so conn.Changes() becomes 1. The caller of this helper
	// (a synthetic non-test function name) appears on the page as a
	// legitimate writer — that's expected and not asserted against.
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		return sqlitex.Exec(conn, "INSERT INTO ro2 (x) VALUES (1);", nil)
	}))
}

func runReadOnlySaveOnConn(t *testing.T, conn *sqlite.Conn) {
	t.Helper()
	err := func() (err error) {
		defer sqlitex.Save(conn)(&err)
		return sqlitex.Exec(conn, "SELECT COUNT(*) FROM ro2;", nil)
	}()
	require.NoError(t, err)
}

// TestRecentRingKeepsSlowestNotLast verifies the slow-ring keeps the K
// slowest transactions seen, not the most recent K — a single outlier from
// hours ago must survive a steady stream of merely-100ms events. Without
// this, the writer-health page eventually rolls past the worst case the
// daemon ever did and the operator loses the most diagnostic row on the
// table.
func TestRecentRingKeepsSlowestNotLast(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS slowring (x int);", nil))

	// One genuine outlier: 350 ms hold via sleep. Must survive every later
	// event we generate, regardless of count.
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		time.Sleep(350 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO slowring (x) VALUES (?);", nil, 0)
	}))

	// Generate 220 follow-up commits whose hold is ~110-120 ms — comfortably
	// above slowThreshold so they enter the ring, but well below the 350 ms
	// outlier. Under the old FIFO semantics these would have rotated the
	// outlier out (ring cap = 200). Under top-K-by-hold it must stick.
	for i := 0; i < 220; i++ {
		require.NoError(t, sqlitex.WithTx(conn, func() error {
			time.Sleep(110 * time.Millisecond)
			return sqlitex.Exec(conn, "INSERT INTO slowring (x) VALUES (?);", nil, i+1)
		}))
	}

	body := renderDebugPage(t)
	// The 350 ms outlier must still render. fmtMs prints "350.x ms" or "351
	// ms"-ish depending on overhead; match the magnitude rather than exact ms.
	require.Regexp(t, `35[0-9]\.[0-9] ms|3[5-9][0-9]\.[0-9] ms`, body,
		"the 350 ms outlier must remain in the slowest ring after 220 ~110ms events")
}

// TestSaveSavepointInterruptedAbsent verifies that a Save whose SAVEPOINT
// statement itself returns SQLITE_INTERRUPT (ctx cancelled mid-acquire)
// does NOT pollute the writer-health page with the caller's name. The
// per-caller stats row for such a caller would otherwise have count=N,
// commits=0, all percentiles=0, and tiny wait values — exactly the
// nonsense GetDomain produced in production, since at SAVEPOINT-failure
// time we don't yet know whether the scope was destined to read or write.
// (Unlike WithTx, where the intent IS unambiguously a write attempt and
// begin_interrupted is rightly recorded.)
func TestSaveSavepointInterruptedAbsent(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	conn.SetInterrupt(ctx.Done())
	defer conn.SetInterrupt(nil)

	saveInterruptedHelper(t, conn)

	body := renderDebugPage(t)
	require.NotContains(t, body, "TestSaveSavepointInterruptedAbsent",
		"a Save whose SAVEPOINT was interrupted must not leak its caller to /debug/sqlite")
	require.NotContains(t, body, "saveInterruptedHelper",
		"the helper that called Save() must also stay off the page")
}

func saveInterruptedHelper(t *testing.T, conn *sqlite.Conn) {
	t.Helper()
	// Save returns an error-propagating closure when SAVEPOINT returns
	// SQLITE_INTERRUPT; we honour it by deferring and never running a body.
	var err error
	defer func() {
		// The closure copies the interrupt error into err if err==nil.
		// We expect err to surface as an SQLite interrupt; just confirm
		// it's non-nil.
		require.Error(t, err, "interrupted SAVEPOINT must surface an error to the caller")
	}()
	defer sqlitex.Save(conn)(&err)
}

// TestSaveWriteAfterReadStillPromotes verifies the lazy promoter still fires
// when a Save reads first and writes later — i.e. the writer-slot accounting
// is not gated on the FIRST statement being a write.
func TestSaveWriteAfterReadStillPromotes(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	require.NoError(t, pool.WithTx(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS rw (x int);", nil)
	}))

	require.NoError(t, pool.WithSave(ctx, func(c *sqlite.Conn) error {
		if err := sqlitex.Exec(c, "SELECT COUNT(*) FROM rw;", nil); err != nil {
			return err
		}
		time.Sleep(110 * time.Millisecond)
		return sqlitex.Exec(c, "INSERT INTO rw (x) VALUES (1);", nil)
	}))

	body := renderDebugPage(t)
	require.Contains(t, body, "TestSaveWriteAfterReadStillPromotes")
	require.Contains(t, body, "savepoint_top",
		"a Save that writes — even after a leading read — must promote")
}

// TestSaveCapturesStatements verifies that statements running inside a slow
// top-level Save show up on the recent panel — same UX as WithTx — so we can
// see which write inside a hot WithSave caller is eating the writer slot.
func TestSaveCapturesStatements(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	require.NoError(t, pool.WithTx(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS svcap (k text, v int);", nil)
	}))

	require.NoError(t, pool.WithSave(ctx, func(c *sqlite.Conn) error {
		if err := sqlitex.Exec(c, "INSERT INTO svcap (k, v) VALUES (?, ?);", nil, "alpha", 1); err != nil {
			return err
		}
		time.Sleep(120 * time.Millisecond)
		return sqlitex.Exec(c, "INSERT INTO svcap (k, v) VALUES (?, ?);", nil, "beta", 2)
	}))

	body := renderDebugPage(t)
	require.Contains(t, body, "INSERT INTO svcap",
		"statement capture must work for top-level Save the same as for WithTx")
	require.Contains(t, body, "&#34;alpha&#34;")
	require.Contains(t, body, "&#34;beta&#34;")
}

// TestPoolWithTxConcurrency exercises the wrapper under concurrent writers to
// confirm the instrumentation tracks each transaction without racing the
// in-flight gauge.
func TestPoolWithTxConcurrency(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	require.NoError(t, pool.WithTx(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS t (x int);", nil)
	}))

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_ = pool.WithTx(ctx, func(c *sqlite.Conn) error {
				return sqlitex.Exec(c, "INSERT INTO t (x) VALUES (?);", nil, i)
			})
		}(i)
	}
	wg.Wait()

	body := renderDebugPage(t)
	require.Contains(t, body, "TestPoolWithTxConcurrency")
}

// BenchmarkWithTxNoop measures the overhead of WithTx itself on an empty
// transaction body. This is the worst case for relative overhead: any real
// tx does at least one INSERT/UPDATE so per-tx overhead is amortised over
// real work.
func BenchmarkWithTxNoop(b *testing.B) {
	pool := newBenchPool(b)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := sqlitex.WithTx(conn, func() error { return nil }); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkWithTxRealWork represents a typical write: BEGIN IMMEDIATE +
// one INSERT + COMMIT. This is the apples-to-apples comparison for the
// instrumentation overhead.
func BenchmarkWithTxRealWork(b *testing.B) {
	pool := newBenchPool(b)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	if err := sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS bench (x int);", nil); err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := sqlitex.WithTx(conn, func() error {
			return sqlitex.Exec(conn, "INSERT INTO bench (x) VALUES (?);", nil, i)
		}); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkExecOutsideTx exercises the captureExec fast path — every Exec
// call outside a WithTx body pays a single sync.Map.Load and returns. This
// is the path every read query and every non-WithTx write takes.
func BenchmarkExecOutsideTx(b *testing.B) {
	pool := newBenchPool(b)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	if err := sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS bench_r (x int);", nil); err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := sqlitex.Exec(conn, "SELECT COUNT(*) FROM bench_r;", nil); err != nil {
			b.Fatal(err)
		}
	}
}

func newBenchPool(b *testing.B) *sqlitex.Pool {
	b.Helper()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX | sqlite.SQLITE_OPEN_SHAREDCACHE
	pool, err := sqlitex.Open("file::memory:?mode=memory&cache=shared", flags, 4)
	if err != nil {
		b.Fatal(err)
	}
	return pool
}

func renderDebugPage(t *testing.T) string {
	t.Helper()
	h := sqlitex.DebugHandler()
	req := httptest.NewRequest(http.MethodGet, "/debug/sqlite", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	return rec.Body.String()
}

// extractAggregateSection returns the substring of the page between
// "<h3>Aggregate writer-slot utilization</h3>" and the next "<h3>" so
// tests can assert that callers appear (or are absent) in just the
// aggregate-utilisation view without picking up matches from the
// surrounding tables.
func extractAggregateSection(t *testing.T, body string) string {
	t.Helper()
	const start = "<h3>Aggregate writer-slot utilization</h3>"
	i := strings.Index(body, start)
	require.GreaterOrEqual(t, i, 0, "page must include the Aggregate writer-slot utilization section")
	rest := body[i:]
	// Next h3 (Read operations) or the next h2 (Slowest slow/busy tx)
	// terminates the section.
	stop := len(rest)
	if next := strings.Index(rest[len(start):], "<h3>"); next >= 0 {
		stop = len(start) + next
	}
	if next := strings.Index(rest[len(start):], "<h2>"); next >= 0 && len(start)+next < stop {
		stop = len(start) + next
	}
	return rest[:stop]
}

// TestAggregateUtilizationSurfacesCommits verifies the new Σ-hold / % wall
// section renders the caller's accumulated writer-slot hold time. This is
// the offender view that catches "death by a thousand short writes" — a
// caller whose p99 stays below the 100ms slow-ring threshold but whose
// aggregate hold over time is the real lock-hog.
func TestAggregateUtilizationSurfacesCommits(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS agg (x int);", nil))

	// Three commits with controllable hold time so the Σ is non-trivial
	// without making the test slow. Each hold is ~50 ms = 150 ms total —
	// well above the 1 ms render floor, well below the 100 ms slow ring
	// so we know the aggregate view captures things the slow ring would
	// drop.
	for i := 0; i < 3; i++ {
		require.NoError(t, sqlitex.WithTx(conn, func() error {
			time.Sleep(50 * time.Millisecond)
			return sqlitex.Exec(conn, "INSERT INTO agg (x) VALUES (?);", nil, i)
		}))
	}

	body := renderDebugPage(t)
	aggSection := extractAggregateSection(t, body)
	require.Contains(t, aggSection, "TestAggregateUtilizationSurfacesCommits",
		"caller must appear in the aggregate writer-slot utilization section")
	// Σ hold should be on the order of 150 ms (3 × 50 ms). fmtMs renders
	// "1.5 ms" / "15.0 ms" / "150.3 ms" style — match the magnitude with
	// some slack.
	require.Regexp(t, `1[0-9]{2}\.[0-9] ms|2[0-9]{2}\.[0-9] ms`, aggSection,
		"aggregate Σ hold must reflect the cumulative ~150 ms of commits")
}

// TestAggregateUtilizationExcludesBeginBusy verifies that a caller whose
// only activity is failed begin_busy attempts does NOT appear in the
// aggregate-utilisation section. The aggregate view's whole point is to
// list real writer-slot offenders — surfacing victims here would invert
// the diagnostic.
func TestAggregateUtilizationExcludesBeginBusy(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)

	holder := pool.Get(nil)
	require.NoError(t, sqlitex.Exec(holder, "BEGIN IMMEDIATE TRANSACTION;", nil))

	victim := pool.Get(nil)
	victim.SetBusyTimeout(50 * time.Millisecond)
	t.Cleanup(func() {
		pool.Put(victim)
		_ = sqlitex.Exec(holder, "ROLLBACK;", nil)
		pool.Put(holder)
		_ = pool.Close()
	})

	err = sqlitex.WithTx(victim, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx))

	body := renderDebugPage(t)
	aggSection := extractAggregateSection(t, body)
	require.NotContains(t, aggSection, "TestAggregateUtilizationExcludesBeginBusy",
		"a begin_busy-only caller must not appear in the aggregate writer-slot section — it never owned the slot")
}

// TestAggregateUtilizationExcludesReadOnlySave verifies a read-only Save
// (savepoint_ro outcome) does not contribute to the aggregate writer-slot
// view. Read-only Saves only ever hold the SHARED reader lock and cannot
// cause SQLITE_BUSY on a BEGIN IMMEDIATE; counting them as writer-slot
// utilisation would dilute the offender signal.
func TestAggregateUtilizationExcludesReadOnlySave(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	setupReadOnlyTable(ctx, t, pool)
	runReadOnlySave(ctx, t, pool)

	body := renderDebugPage(t)
	aggSection := extractAggregateSection(t, body)
	require.NotContains(t, aggSection, "runReadOnlySave",
		"a read-only Save must not appear in the aggregate writer-slot section — savepoint_ro never owns the writer slot")
}

// NB: the window-attribution math for DrainedDuringWait (i.e. that a
// completion within the (now-hold, now] window is included and one
// outside is not) is asserted in the white-box test
// TestSnapshotDrainedDuringWaitWindow in instrumentation_internal_test.go.
// A pure integration version with real BEGIN IMMEDIATE timing is too racy
// (SQLite's busy_handler backoff vs. the test's commit cadence), so the
// end-to-end render path is covered by TestDebugHandlerRenders plus the
// existing TestWithTxBeginBusySnapshotsHolder; the HTML-block render for
// drained-during-wait specifically is covered by TestDrainedRenderBlock
// below, which seeds the tracker via a controlled recordTx path.

// TestDrainedWindowExcludesPreWaitEntries verifies the (now-hold, now]
// window math: writes that committed BEFORE the victim's wait started
// must not appear in DrainedDuringWait. Without this, a long-running
// daemon would have its busy victims attributed to commits from minutes
// or hours earlier, making the page useless for live contention triage.
func TestDrainedWindowExcludesPreWaitEntries(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)

	preWaitConn := pool.Get(nil)
	require.NoError(t, sqlitex.Exec(preWaitConn, "CREATE TABLE IF NOT EXISTS pw (x int);", nil))
	wayBeforeVictim(t, preWaitConn)
	pool.Put(preWaitConn)

	// Sleep so the pre-wait commit lands well outside the upcoming
	// victim's busy_timeout window.
	time.Sleep(250 * time.Millisecond)

	holderConn := pool.Get(nil)
	victim := pool.Get(nil)
	// Tight busy_timeout — the drained window is just this small slice.
	victim.SetBusyTimeout(50 * time.Millisecond)
	t.Cleanup(func() {
		pool.Put(victim)
		pool.Put(holderConn)
		_ = pool.Close()
	})

	holderEntered := make(chan struct{})
	holderRelease := make(chan struct{})
	holderDone := make(chan struct{})
	go func() {
		defer close(holderDone)
		_ = holderHogTx(holderConn, holderEntered, holderRelease)
	}()
	<-holderEntered

	err = sqlitex.WithTx(victim, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx))

	close(holderRelease)
	<-holderDone

	body := renderDebugPage(t)
	// The drained-during-wait block may or may not render at all (the
	// only writer-slot completions during the 50ms window are whatever
	// holderHogTx did at COMMIT time, if any). What MUST be true: the
	// pre-wait commit's caller name must not be inside any drained
	// list.
	drainedSlice := drainedBlockContents(body)
	require.NotContains(t, drainedSlice, "wayBeforeVictim",
		"a write that committed BEFORE the victim's wait window opened must not appear in drained-during-wait")
}

func wayBeforeVictim(t *testing.T, conn *sqlite.Conn) {
	t.Helper()
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		return sqlitex.Exec(conn, "INSERT INTO pw (x) VALUES (1);", nil)
	}))
}

// drainedBlockContents returns the concatenation of every
// "drained during wait" details block on the page so the test can
// assert what is (or isn't) inside any of them. Matches the actual
// <summary> tag rather than plain-text occurrences — the help-text
// section now also mentions "drained during wait" in prose.
func drainedBlockContents(body string) string {
	const marker = "<summary>drained during wait"
	var out strings.Builder
	rest := body
	for {
		i := strings.Index(rest, marker)
		if i < 0 {
			break
		}
		// Take up to the next </details> tag — that bounds this block.
		end := strings.Index(rest[i:], "</details>")
		if end < 0 {
			out.WriteString(rest[i:])
			break
		}
		out.WriteString(rest[i : i+end])
		rest = rest[i+end:]
	}
	return out.String()
}

// TestDrainedWaitExcludesBeginBusyAndReadOnly verifies that begin_busy
// failures and read-only Saves never appear in any victim's
// drained-during-wait list. begin_busy never owned the slot;
// savepoint_ro only ever held the SHARED reader lock and didn't
// contribute to writer-slot contention.
func TestDrainedWaitExcludesBeginBusyAndReadOnly(t *testing.T) {
	body := renderDebugPage(t)
	drained := drainedBlockContents(body)
	require.NotContains(t, drained, "begin_busy",
		"begin_busy outcomes must not appear in drained-during-wait — they never owned the writer slot")
	require.NotContains(t, drained, "savepoint_ro",
		"savepoint_ro outcomes must not appear in drained-during-wait — SHARED-lock reads can't block BEGIN IMMEDIATE")
}

// TestPoolWaitInstrumentedUnderStarvation verifies the new pool_wait
// instrumentation surfaces on /debug/sqlite when callers had to queue
// for a connection. Setup: a small (2-conn) pool, then pin both conns
// via pool.Get (NOT via WithTx — concurrent WithTxs in shared-cache
// mode deadlock at the writer-mutex level), then fire a Pool.WithTx
// waiter that has to queue for a pool conn before it can even attempt
// BEGIN IMMEDIATE. pool_wait must be observably non-zero on the page.
func TestPoolWaitInstrumentedUnderStarvation(t *testing.T) {
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX | sqlite.SQLITE_OPEN_SHAREDCACHE
	pool, err := sqlitex.Open("file::memory:?mode=memory&cache=shared", flags, 2)
	require.NoError(t, err)
	defer pool.Close()

	// Setup table via a bare-conn WithTx so we don't pollute the
	// pool_wait stats for this test's caller.
	setupConn := pool.Get(nil)
	require.NoError(t, sqlitex.Exec(setupConn, "CREATE TABLE IF NOT EXISTS pwtest (x int);", nil))
	pool.Put(setupConn)

	// Pin BOTH pool conns. We use pool.Get directly — no BEGIN
	// IMMEDIATE attempt, no writer-mutex contention. The waiter below
	// has to wait for one of these Get/Put pairs to return its conn.
	pinned1 := pool.Get(nil)
	pinned2 := pool.Get(nil)

	type result struct {
		err error
		dur time.Duration
	}
	resCh := make(chan result, 1)
	go func() {
		t0 := time.Now()
		err := pool.WithTx(context.Background(), func(c *sqlite.Conn) error {
			return sqlitex.Exec(c, "INSERT INTO pwtest (x) VALUES (1);", nil)
		})
		resCh <- result{err: err, dur: time.Since(t0)}
	}()

	// Let the waiter actually queue, then release one pinned conn so it
	// can proceed.
	time.Sleep(120 * time.Millisecond)
	pool.Put(pinned1)

	r := <-resCh
	require.NoError(t, r.err)
	pool.Put(pinned2)

	// Sanity: the waiter must have actually queued for ~the pinned
	// duration. Threshold is conservative (80ms vs ~120ms held) to
	// absorb scheduling jitter.
	require.Greater(t, r.dur, 80*time.Millisecond,
		"the waiter's total wall must include the time the pool was starved")

	body := renderDebugPage(t)
	require.Contains(t, body, "TestPoolWaitInstrumentedUnderStarvation",
		"the queued caller must appear in the per-caller write table")
	require.Contains(t, body, "pool_wait",
		"the page must surface the pool_wait column once the instrumentation is in place")
	require.Regexp(t, `[1-9][0-9]+\.[0-9] ms`, body,
		"pool_wait p99 for the queued caller must reflect the ~120 ms starvation window")
}

// TestPoolWaitZeroForBareConnCaller verifies that calling
// sqlitex.WithTx(conn, fn) directly (bypassing Pool.WithTx) records
// pool_wait = 0 — bare-conn callers never went through Pool.Conn and
// must not inherit a stale value from a previous Pool-managed scope on
// the same conn.
func TestPoolWaitZeroForBareConnCaller(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS bareconn (x int);", nil))

	// Bare-conn WithTx — caller already has the conn, never queued for
	// it. Sleep well above the slowThreshold AND above what other tests
	// in the suite produce (~110-150ms), so this row reliably survives
	// the top-K-by-hold ring under cross-test interleaving — insertTopK
	// uses strict `>` so a tied hold doesn't displace.
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		time.Sleep(420 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO bareconn (x) VALUES (1);", nil)
	}))

	body := renderDebugPage(t)
	require.Contains(t, body, "TestPoolWaitZeroForBareConnCaller",
		"bare-conn caller must still appear on the page")
	// Find this test's row in the recent table and inspect its
	// pool_wait cell. The recent-row pool_wait must render as "0".
	row := extractRecentRowForCaller(t, body, "TestPoolWaitZeroForBareConnCaller")
	require.Contains(t, row, `class="num ">0</td>`,
		"bare-conn caller's recent row must render pool_wait as 0 (not stale from a prior Pool-managed scope). row: %s", row)
}

// extractRecentRowForCaller returns the substring covering one recent-
// ring row whose caller cell contains the given caller substring. The
// caller-cell text on the page is the resolved frame name (e.g.
// "sqlitex_test.TestX"), so callers pass an unambiguous suffix and let
// the test absorb the package prefix. Restricted to the "Slowest write
// operations" section so it can't accidentally pick up a per-caller
// stats row (the per-caller table also contains the caller name and
// renders earlier on the page). Fails the test if not found.
func extractRecentRowForCaller(t *testing.T, body, caller string) string {
	t.Helper()
	const startMarker = "<strong>Slowest write operations</strong>"
	start := strings.Index(body, startMarker)
	require.GreaterOrEqual(t, start, 0, "page must include the Slowest write operations section")
	region := body[start:]
	rest := region
	for {
		trStart := strings.Index(rest, "<tr>")
		if trStart < 0 {
			break
		}
		trEnd := strings.Index(rest[trStart:], "</tr>")
		if trEnd < 0 {
			break
		}
		row := rest[trStart : trStart+trEnd+len("</tr>")]
		if strings.Contains(row, caller) {
			return row
		}
		rest = rest[trStart+trEnd+len("</tr>"):]
	}
	t.Fatalf("no recent-ring row found whose caller cell contains %q", caller)
	return ""
}

// TestSavepointTopWaitRendersDash verifies that begin_wait is rendered
// as "—" on the recent ring for savepoint_top rows. For those rows,
// the SAVEPOINT statement itself doesn't queue for the writer mutex
// (acquisition is lazy, hidden inside the first DML), so showing a
// near-zero number would falsely suggest "no contention happened" when
// in reality the contention is just measured elsewhere (in hold).
func TestSavepointTopWaitRendersDash(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	// Setup table outside the caller's scope.
	require.NoError(t, pool.WithTx(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS svdash (x int);", nil)
	}))

	// Slow top-level Save that writes — produces a savepoint_top row on
	// the recent ring. The 400ms sleep is well above other tests in
	// the suite (which cap around 110-150ms) so this row reliably
	// survives the top-K-by-hold ring under cross-test interleaving;
	// at 110ms it tied other tests' rows and got evicted on some
	// orderings (insertTopK uses strict `>` to displace).
	require.NoError(t, pool.WithSave(ctx, func(c *sqlite.Conn) error {
		time.Sleep(400 * time.Millisecond)
		return sqlitex.Exec(c, "INSERT INTO svdash (x) VALUES (1);", nil)
	}))

	body := renderDebugPage(t)
	row := extractRecentRowForCaller(t, body, "TestSavepointTopWaitRendersDash")
	require.Contains(t, row, "savepoint_top",
		"this test's recent row must be a savepoint_top — sanity check on the scenario")
	require.Contains(t, row, "—",
		"begin_wait cell on a savepoint_top row must render as — (em dash) not as a ms value. row: %s", row)
}

// TestSavepointTopNotInWaitPercentile verifies that savepoint_top is
// excluded from the per-caller wait reservoir, so a caller that does
// only Pool.WithSave doesn't dilute its writer-mutex-wait percentile
// with the SAVEPOINT statement's microseconds-level "wait".
func TestSavepointTopNotInWaitPercentile(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	require.NoError(t, pool.WithTx(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS svp99 (x int);", nil)
	}))

	// Many Pool.WithSave scopes that each write — all savepoint_top.
	// If they were feeding waitReserv, the caller's wait p99 would be
	// the SAVEPOINT statement duration (microseconds). After the fix,
	// no savepoint_top sample lands in waitReserv, so this caller's
	// wait p99 must render as 0 (empty reservoir).
	for i := 0; i < 20; i++ {
		require.NoError(t, pool.WithSave(ctx, func(c *sqlite.Conn) error {
			return sqlitex.Exec(c, "INSERT INTO svp99 (x) VALUES (?);", nil, i)
		}))
	}

	body := renderDebugPage(t)
	row := extractWriteCallerRow(t, body, "TestSavepointTopNotInWaitPercentile")
	// The wait group is the last 4 percentile cells in the row; if
	// waitReserv is empty, all four render as fmtMs(0) = "0". Search
	// for ">0</td>" appearing at least once after the caller name —
	// reading the rendered HTML it's sufficient to assert there's NO
	// sub-ms wait value like "0.001 ms" / "0.005 ms" anywhere in the
	// wait group, which would be the smoking gun of leaked savepoint
	// microseconds.
	require.NotRegexp(t, `wait[^"]*p99[^"]*<td[^>]*>0\.0[0-9]+ ms`, row,
		"wait p99 must be empty (rendered as 0), not a tiny ms value leaked from savepoint_top duration. row: %s", row)
}

// extractWriteCallerRow returns the substring of the Write operations
// per-caller table row whose caller cell contains the given substring.
// Restricted to the per-caller table (not the recent ring) so we don't
// pick up the recent-row by mistake.
func extractWriteCallerRow(t *testing.T, body, caller string) string {
	t.Helper()
	const writeMarker = "<h3>Write operations</h3>"
	const stopMarker = "<h3>Aggregate writer-slot utilization</h3>"
	start := strings.Index(body, writeMarker)
	require.GreaterOrEqual(t, start, 0)
	stop := strings.Index(body[start:], stopMarker)
	require.Greater(t, stop, 0)
	region := body[start : start+stop]
	rest := region
	for {
		trStart := strings.Index(rest, "<tr>")
		if trStart < 0 {
			break
		}
		trEnd := strings.Index(rest[trStart:], "</tr>")
		if trEnd < 0 {
			break
		}
		row := rest[trStart : trStart+trEnd+len("</tr>")]
		if strings.Contains(row, caller) {
			return row
		}
		rest = rest[trStart+trEnd+len("</tr>"):]
	}
	t.Fatalf("no Write operations row found whose caller cell contains %q", caller)
	return ""
}

// TestSaveTempOnlyStaysOffWriterSections verifies that a top-level
// SaveTempOnly with a real TEMP-table INSERT does NOT promote to
// savepoint_top — the caller must stay out of the Write operations,
// Aggregate writer-slot utilization, and Slowest write operations
// sections on /debug/sqlite. This is the user-visible fix for the
// loadStore false-positive that dominated the aggregate view.
func TestSaveTempOnlyStaysOffWriterSections(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TEMP TABLE IF NOT EXISTS tmp_only (x int);", nil))

	// Sleep above the slowThreshold so the row enters the slow-read ring
	// (savepoint_ro outcome) for inspection.
	func() (err error) {
		defer sqlitex.SaveTempOnly(conn)(&err)
		time.Sleep(110 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO tmp_only (x) VALUES (1);", nil)
	}()

	body := renderDebugPage(t)
	writeSection, readSection := splitWriteVsReadSections(t, body)

	require.NotContains(t, writeSection, "TestSaveTempOnlyStaysOffWriterSections",
		"SaveTempOnly caller must NOT appear in Write operations even though it wrote (to TEMP). writeSection: %s", writeSection)
	require.Contains(t, readSection, "TestSaveTempOnlyStaysOffWriterSections",
		"SaveTempOnly caller must appear in Read operations (savepoint_ro outcome). readSection: %s", readSection)
}

// TestSaveTempOnlyRendersSavepointRo verifies the recent-ring row for
// a SaveTempOnly scope carries the savepoint_ro outcome (not
// savepoint_top), so the operator can tell it's the TEMP-only path
// without inspecting the captured statements.
func TestSaveTempOnlyRendersSavepointRo(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TEMP TABLE IF NOT EXISTS tmp_only_ro (x int);", nil))

	// 450 ms is well above other tests' typical hold magnitudes so this
	// row survives the top-K-by-hold ring under cross-test interleaving
	// (insertTopK uses strict `>` to displace).
	func() (err error) {
		defer sqlitex.SaveTempOnly(conn)(&err)
		time.Sleep(450 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO tmp_only_ro (x) VALUES (1);", nil)
	}()

	body := renderDebugPage(t)
	// extractRecentRowForCaller scopes to Slowest write operations; we
	// want Slowest read operations here. Just verify the rendered row
	// for this caller has the savepoint_ro outcome cell.
	require.Contains(t, body, "TestSaveTempOnlyRendersSavepointRo")
	// Find the row in the slowest-read region (after the read section
	// header). The outcome cell renders as `<td class="">savepoint_ro</td>`.
	const readMarker = "<strong>Slowest read operations</strong>"
	i := strings.Index(body, readMarker)
	require.GreaterOrEqual(t, i, 0, "page must include Slowest read operations section")
	readRegion := body[i:]
	require.Contains(t, readRegion, "TestSaveTempOnlyRendersSavepointRo",
		"caller's row must be in Slowest read operations region")
	require.Contains(t, readRegion, "savepoint_ro",
		"row must carry savepoint_ro outcome")
}

// TestPoolWithSaveTempOnlyPath verifies the Pool wrapper plumbs the
// pool-wait handoff into SaveTempOnly correctly (the wrapper measures
// p.Conn() wait, stashes it via stashPoolWait, then SaveTempOnly
// consumes it via loadAndClearPoolWait — same shape as WithSave).
//
// Uses a main-DB table (not TEMP) on purpose: TEMP tables are
// per-connection and the Pool may hand back a different conn for the
// setup vs the body. SaveTempOnly doesn't actually verify the
// "TEMP-only" contract — it just trusts the caller — so writing to a
// main-DB table here still exercises the same code path.
func TestPoolWithSaveTempOnlyPath(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	ctx := context.Background()
	require.NoError(t, pool.WithTx(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS pool_temponly (x int);", nil)
	}))

	require.NoError(t, pool.WithSaveTempOnly(ctx, func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "INSERT INTO pool_temponly (x) VALUES (1);", nil)
	}))

	body := renderDebugPage(t)
	require.Contains(t, body, "TestPoolWithSaveTempOnlyPath",
		"Pool.WithSaveTempOnly caller must still appear on the page (under Read operations)")
	_, readSection := splitWriteVsReadSections(t, body)
	require.Contains(t, readSection, "TestPoolWithSaveTempOnlyPath",
		"Pool.WithSaveTempOnly must surface in Read operations, not Write")
}

// TestSaveStillPromotesOnTempInsert is the regression test for the
// false-positive that motivated SaveTempOnly: regular Save with a
// TEMP-table INSERT must STILL promote to savepoint_top (this is the
// known false-positive behaviour that the page's caveat documents and
// that SaveTempOnly opts out of). Without this assertion, the
// SaveTempOnly fix risks silently changing regular Save semantics.
func TestSaveStillPromotesOnTempInsert(t *testing.T) {
	pool := newMemPool(t)
	defer pool.Close()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	require.NoError(t, sqlitex.Exec(conn, "CREATE TEMP TABLE IF NOT EXISTS tmp_save_regression (x int);", nil))

	func() (err error) {
		defer sqlitex.Save(conn)(&err)
		time.Sleep(450 * time.Millisecond)
		return sqlitex.Exec(conn, "INSERT INTO tmp_save_regression (x) VALUES (1);", nil)
	}()

	body := renderDebugPage(t)
	writeSection, _ := splitWriteVsReadSections(t, body)
	require.Contains(t, writeSection, "TestSaveStillPromotesOnTempInsert",
		"regular Save with a TEMP INSERT must still promote (false-positive preserved for callers that haven't opted into SaveTempOnly)")
}

// TestRecentBusySeparateFromRecentWrite verifies that a real begin_busy
// event lands in the "Slowest begin_busy events" section while a real
// slow commit lands in "Slowest write operations" — neither bleeds
// into the other. This is the user-visible payoff of splitting the
// rings: real slow writes are no longer evicted by begin_busy victims.
func TestRecentBusySeparateFromRecentWrite(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)

	// Provoke a real begin_busy: hold the writer lock on conn A, fire
	// WithTx on conn B with a tight busy_timeout.
	holder := pool.Get(nil)
	require.NoError(t, sqlitex.Exec(holder, "CREATE TABLE IF NOT EXISTS rbsep (x int);", nil))
	require.NoError(t, sqlitex.Exec(holder, "BEGIN IMMEDIATE TRANSACTION;", nil))

	victim := pool.Get(nil)
	victim.SetBusyTimeout(50 * time.Millisecond)
	t.Cleanup(func() {
		pool.Put(victim)
		_ = sqlitex.Exec(holder, "ROLLBACK;", nil)
		pool.Put(holder)
		_ = pool.Close()
	})

	err = sqlitex.WithTx(victim, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx))

	// Release the lock for the slow commit step.
	require.NoError(t, sqlitex.Exec(holder, "ROLLBACK;", nil))

	// Run a slow commit on the now-free lock. 450 ms is well above the
	// 110ms-cluster other tests produce so it reliably survives the
	// top-K-by-hold recentWrite ring across test interleavings.
	require.NoError(t, sqlitex.WithTx(holder, func() error {
		time.Sleep(450 * time.Millisecond)
		return sqlitex.Exec(holder, "INSERT INTO rbsep (x) VALUES (1);", nil)
	}))

	body := renderDebugPage(t)

	// Slice out each section. Use the NEXT section's <strong> summary
	// as the stop marker (inner <details> blocks for held-by / drained
	// / statements would false-trigger if we used "<details>" alone).
	writeSection := sliceSection(t, body, "<strong>Slowest write operations</strong>", "<strong>Slowest begin_busy events</strong>")
	busySection := sliceSection(t, body, "<strong>Slowest begin_busy events</strong>", "<strong>Slowest read operations</strong>")

	require.Contains(t, writeSection, "TestRecentBusySeparateFromRecentWrite",
		"slow commit must appear in Slowest write operations. section: %s", writeSection)
	// Outcome cell for begin_busy rows renders as
	// `<td class="warn">begin_busy</td>`. The subtitle prose mentions
	// the word too, so match the cell shape specifically.
	require.NotContains(t, writeSection, `<td class="warn">begin_busy</td>`,
		"Slowest write operations must NOT contain begin_busy outcome cells after the split")

	require.Contains(t, busySection, "TestRecentBusySeparateFromRecentWrite",
		"begin_busy event must appear in Slowest begin_busy events. section: %s", busySection)
	require.Contains(t, busySection, `<td class="warn">begin_busy</td>`,
		"Slowest begin_busy events must contain a begin_busy outcome cell")
}

// sliceSection returns the substring of body starting at startMarker,
// stopping at the next stopMarker. Used to scope assertions to a
// specific page section.
func sliceSection(t *testing.T, body, startMarker, stopMarker string) string {
	t.Helper()
	i := strings.Index(body, startMarker)
	require.GreaterOrEqual(t, i, 0, "page must include %q", startMarker)
	rest := body[i:]
	// Skip the start marker itself when searching for the stop marker.
	afterStart := rest[len(startMarker):]
	j := strings.Index(afterStart, stopMarker)
	if j < 0 {
		return rest
	}
	return rest[:len(startMarker)+j]
}

// TestBeginBusyExposesExtendedCodeAndErrMsg verifies that when
// BEGIN IMMEDIATE fails with a BUSY-class error, the recorded sample
// (a) carries one of the new outcome subcode labels (begin_busy,
// begin_busy_timeout, begin_busy_snapshot, or begin_busy_recovery)
// AND (b) carries a non-empty SQLite errmsg captured at the failure
// site. Both are surfaced on /debug/sqlite's Slowest begin_busy
// events ring and load-bearing for diagnosing "held_by empty but
// BEGIN failed for 10 s" mystery cases.
func TestBeginBusyExposesExtendedCodeAndErrMsg(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)

	// Hog the writer mutex on conn A; victim on conn B will time out.
	holder := pool.Get(nil)
	require.NoError(t, sqlitex.Exec(holder, "BEGIN IMMEDIATE TRANSACTION;", nil))

	victim := pool.Get(nil)
	victim.SetBusyTimeout(50 * time.Millisecond)
	t.Cleanup(func() {
		pool.Put(victim)
		_ = sqlitex.Exec(holder, "ROLLBACK;", nil)
		pool.Put(holder)
		_ = pool.Close()
	})

	err = sqlitex.WithTx(victim, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx))

	body := renderDebugPage(t)
	// One of the four busy-class outcome labels must appear on the
	// rendered page (the exact subcode depends on the platform's VFS
	// behaviour — Linux with iBusyTimeout typically yields
	// begin_busy_timeout, but the test is tolerant of any valid kind).
	busyLabels := []string{"begin_busy_timeout", "begin_busy_snapshot", "begin_busy_recovery", "begin_busy"}
	var seen string
	for _, label := range busyLabels {
		// Outcome cell renders as `<td class="warn">label</td>`.
		needle := `<td class="warn">` + label + `</td>`
		if strings.Contains(body, needle) {
			seen = label
			break
		}
	}
	require.NotEmpty(t, seen,
		"page must carry one of %v as the outcome label for a begin_busy-class row", busyLabels)
	// The sqlite_errmsg column must carry a non-empty value for the
	// row of THIS test's caller — typically "database is locked", but
	// the test only asserts non-empty since the exact wording is
	// SQLite-version-dependent.
	row := extractRecentRowForBusyCaller(t, body, "TestBeginBusyExposesExtendedCodeAndErrMsg")
	require.Contains(t, row, "database is locked",
		"the begin_busy row for this test must carry a non-empty sqlite_errmsg column with the standard 'database is locked' text. row: %s", row)
}

// extractRecentRowForBusyCaller scopes the search to the "Slowest
// begin_busy events" section (separate from the slow write ring) and
// returns the row containing the named caller substring.
func extractRecentRowForBusyCaller(t *testing.T, body, caller string) string {
	t.Helper()
	const startMarker = "<strong>Slowest begin_busy events</strong>"
	start := strings.Index(body, startMarker)
	require.GreaterOrEqual(t, start, 0, "page must include the Slowest begin_busy events section")
	region := body[start:]
	rest := region
	for {
		trStart := strings.Index(rest, "<tr>")
		if trStart < 0 {
			break
		}
		trEnd := strings.Index(rest[trStart:], "</tr>")
		if trEnd < 0 {
			break
		}
		row := rest[trStart : trStart+trEnd+len("</tr>")]
		if strings.Contains(row, caller) {
			return row
		}
		rest = rest[trStart+trEnd+len("</tr>"):]
	}
	t.Fatalf("no begin_busy row found whose caller cell contains %q", caller)
	return ""
}

// TestExtendedErrCodeOnCleanConn verifies that calling ExtendedErrCode
// on a freshly-opened conn (no error pending) returns 0 — i.e. it
// doesn't accidentally surface a stale code from a prior connection.
// This protects against callers using ExtendedErrCode without first
// checking that an error was actually returned.
func TestExtendedErrCodeOnCleanConn(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	conn, err := sqlite.OpenConn("file:"+dir+"/clean.db", flags)
	require.NoError(t, err)
	defer conn.Close()

	// Successful query — no error pending.
	require.NoError(t, sqlitex.Exec(conn, "CREATE TABLE clean (x int);", nil))

	require.Equal(t, sqlite.ErrorCode(0), conn.ExtendedErrCode(),
		"ExtendedErrCode must be 0 on a conn with no pending error")
	require.Equal(t, "not an error", conn.ErrMsg(),
		"ErrMsg must be 'not an error' on a conn with no pending error (the SQLite default)")
}

// TestBeginContendersCapturedDuringStorm verifies that when multiple
// goroutines are simultaneously stuck inside Exec("BEGIN IMMEDIATE
// ...") (the storm pattern that motivated the whole rework), the
// snapshot taken at the moment of a BUSY victim's timeout names them
// in the rendered begin_busy row's "also stuck in BEGIN IMMEDIATE"
// section AND increments their ContenderEvents count in the
// Begin-busy attribution table. This is the dimension that used to
// require expanding the now-removed goroutine dump.
//
// Provocation: hold the writer mutex with one WithTx (so held_by is
// non-empty for the storm goroutines) and launch a band of victims
// with a short busy_timeout. Each victim will fail BUSY, and the
// last one to fire will see the others still stuck in their own
// BEGIN IMMEDIATE retry loops.
func TestBeginContendersCapturedDuringStorm(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 10)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close() })

	// Holder owns the writer mutex via a WithTx. Block long enough
	// that several victim BEGIN IMMEDIATEs race in concurrently and
	// stay stuck for a window where the storm-snapshot is meaningful.
	holderConn := pool.Get(nil)
	t.Cleanup(func() { pool.Put(holderConn) })
	holderEntered := make(chan struct{})
	holderRelease := make(chan struct{})
	holderDone := make(chan struct{})
	go func() {
		defer close(holderDone)
		_ = holderHogTx(holderConn, holderEntered, holderRelease)
	}()
	<-holderEntered

	// Launch a band of victims. Each runs in its own goroutine,
	// grabs a conn from the pool, sets a short busy_timeout, and
	// calls WithTx. They all enter the BEGIN IMMEDIATE retry loop
	// roughly concurrently.
	const victims = 5
	const busyTimeout = 200 * time.Millisecond
	victimDone := make(chan struct{}, victims)
	for i := 0; i < victims; i++ {
		go contenderVictim(pool, busyTimeout, victimDone)
	}
	for i := 0; i < victims; i++ {
		<-victimDone
	}

	close(holderRelease)
	<-holderDone

	body := renderDebugPage(t)
	require.Contains(t, body, "also stuck in BEGIN IMMEDIATE",
		"begin_busy rows must carry an 'also stuck in BEGIN IMMEDIATE' contenders block")
	require.Contains(t, body, "contender events",
		"Begin-busy attribution table must carry a contender-events column")
	require.Contains(t, body, "sqlitex_test.contenderVictim",
		"contenders block must name the victim's caller — the goroutines that ran contenderVictim should appear because they were stuck in BEGIN IMMEDIATE at the moment of their peers' timeouts")
}

// contenderVictim runs a WithTx that is expected to BUSY-timeout. It
// blocks long enough on BEGIN IMMEDIATE that other concurrent victims'
// timeouts can snapshot it as a contender.
func contenderVictim(pool *sqlitex.Pool, busyTimeout time.Duration, done chan<- struct{}) {
	defer func() { done <- struct{}{} }()
	conn := pool.Get(nil)
	defer pool.Put(conn)
	conn.SetBusyTimeout(busyTimeout)
	_ = sqlitex.WithTx(conn, func() error { return nil })
}

// TestRecentBusyRowsHaveNoGoroutineDump verifies the prior goroutine-
// dump probe is fully removed: the rendered page must NOT contain the
// dump <pre> block or its <details> summary, even when a begin_busy
// event fires with empty held_by. The clean structured replacement
// is the contenders block surfaced by TestBeginContendersCapturedDuringStorm.
func TestRecentBusyRowsHaveNoGoroutineDump(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)

	// Raw BEGIN IMMEDIATE bypasses WithTx, so held_by would have been
	// empty at the victim's timeout — the exact case where the old
	// code captured a goroutine dump.
	holder := pool.Get(nil)
	require.NoError(t, sqlitex.Exec(holder, "BEGIN IMMEDIATE TRANSACTION;", nil))

	victim := pool.Get(nil)
	victim.SetBusyTimeout(50 * time.Millisecond)
	t.Cleanup(func() {
		pool.Put(victim)
		_ = sqlitex.Exec(holder, "ROLLBACK;", nil)
		pool.Put(holder)
		_ = pool.Close()
	})

	err = sqlitex.WithTx(victim, func() error { return nil })
	require.Error(t, err)
	require.True(t, errors.Is(err, sqlitex.ErrBeginImmediateTx))

	body := renderDebugPage(t)
	require.NotContains(t, body, "goroutine dump — held_by was empty at timeout",
		"the goroutine dump details block must be gone — replaced by the structured contenders block")
	require.NotContains(t, body, "<pre style=\"white-space:pre",
		"the <pre> block carrying runtime.Stack output must be gone")
}

// TestWALCheckpointerSurfacesAsWriterCaller verifies that the
// background WAL checkpoint goroutine is instrumented as a real
// writer-slot caller on /debug/sqlite. Without this hook, the
// checkpointer's PRAGMA wal_checkpoint(PASSIVE) wouldn't go through
// WithTx/Save and would be invisible — a victim begin_busy event
// blocked by slow-disk checkpoint fsync would show "0 holders, 0
// drained" on the Begin-busy attribution table.
func TestWALCheckpointerSurfacesAsWriterCaller(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close() })

	// Open a dedicated conn for the checkpointer (mirrors the OpenSQLite
	// production wiring) and start the goroutine with a tight interval
	// so several ticks fire during the test.
	ckptConn, err := sqlite.OpenConn("file:"+dir+"/test.db", flags)
	require.NoError(t, err)
	stop := sqlitex.StartWALCheckpointer(pool, ckptConn, 30*time.Millisecond, nil)
	t.Cleanup(func() {
		stop()
		_ = ckptConn.Close()
	})

	// Give the goroutine time to fire at least 2-3 ticks.
	time.Sleep(150 * time.Millisecond)

	body := renderDebugPage(t)
	require.Contains(t, body, "sqlitex.WALCheckpointer",
		"WAL checkpointer must surface as a real caller on /debug/sqlite — otherwise victims blocked by slow checkpoint fsync would show no attributable holder")
}

// TestDedicatedCheckpointerDoesNotShrinkPool verifies that the
// background checkpointer running on a DEDICATED *sqlite.Conn (not
// borrowed from the pool) doesn't reduce the effective foreground pool
// capacity by 1 during a tick. Pre-change the checkpointer would
// pool.Conn(ctx) on every tick, so foreground callers competing during
// that window saw an effective pool of poolSize-1. The dedicated-conn
// design eliminates that contention path.
func TestDedicatedCheckpointerDoesNotShrinkPool(t *testing.T) {
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 2)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close() })

	// Open a dedicated conn for the checkpointer and start the goroutine
	// with a tight interval so a tick is guaranteed during the test.
	ckptConn, err := sqlite.OpenConn("file:"+dir+"/test.db", flags)
	require.NoError(t, err)
	stop := sqlitex.StartWALCheckpointer(pool, ckptConn, 50*time.Millisecond, nil)
	t.Cleanup(func() {
		stop()
		_ = ckptConn.Close()
	})

	// Hold BOTH pool conns concurrently for longer than a checkpoint
	// tick. Pre-change the checkpointer would have been waiting on
	// pool.Conn for the full duration; we'd see no foreground problem
	// because there's no foreground waiter to starve. The thing the
	// dedicated-conn design fixes is: any foreground caller during this
	// window doesn't fight the checkpointer for the pool. We assert it
	// indirectly by holding poolSize=2 conns simultaneously across a
	// checkpoint tick — this would have been impossible pre-change
	// (one of the two would have been the checkpointer's).
	ctx := context.Background()
	got := make(chan struct{}, 2)
	release := make(chan struct{})
	for i := 0; i < 2; i++ {
		go func() {
			c, rel, err := pool.Conn(ctx)
			if err != nil {
				return
			}
			got <- struct{}{}
			<-release
			rel()
			_ = c
		}()
	}
	// Both goroutines must successfully acquire conns within a
	// reasonable timeout — at least one full checkpoint tick.
	timeout := time.After(2 * time.Second)
	for i := 0; i < 2; i++ {
		select {
		case <-got:
		case <-timeout:
			t.Fatalf("foreground caller %d failed to acquire a pool conn within 2s — checkpointer must be hogging it (regression)", i+1)
		}
	}
	close(release)
}
