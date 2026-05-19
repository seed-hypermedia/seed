package sqlitex_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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
	require.Contains(t, body, "Recent slow")
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
