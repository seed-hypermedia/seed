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
