package sqlitex_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// These tests pin the durability contract that was violated on prod
// hyper.media on 2026-07-24 (10:40-13:04 UTC), when ~2.5 hours of writes that
// StoreBlobs had acknowledged were silently rolled back without any daemon
// restart. The failure was a composition of three behaviors:
//
//  1. WithTx's error path ran ROLLBACK; when that ROLLBACK itself failed —
//     guaranteed when the caller's ctx was canceled, because the binding fails
//     every call on a tripped interrupt before reaching SQLite — the
//     connection was left inside the open transaction (tx.go).
//  2. Pool.Put checked for unreset statements (checkReset) but not for
//     sqlite3_get_autocommit(), so the poisoned connection re-entered the pool
//     with its transaction still open (pool.go).
//  3. WithTx's nested-transaction fallback silently converted subsequent
//     "transactions" on that connection into savepoints (tx.go). Every later
//     writer that leased the single pooled write connection reported success,
//     but its data was invisible to read connections and was destroyed
//     wholesale when the leaked outer transaction eventually rolled back.
//
// The fix closes both ends: WithTx force-rolls-back with the interrupt masked
// whenever its normal cleanup fails, and Pool.Put repairs (rolls back) any
// open transaction it finds on a returned connection, counting repairs in
// LeakedTxRepairs.

// newFilePool returns a file-backed pool, matching production (the shared-cache
// in-memory pool has different locking semantics).
func newFilePool(t *testing.T) *sqlitex.Pool {
	t.Helper()
	dir := t.TempDir()
	flags := sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_CREATE | sqlite.SQLITE_OPEN_URI | sqlite.SQLITE_OPEN_NOMUTEX
	pool, err := sqlitex.Open("file:"+dir+"/test.db", flags, 4)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close() })
	return pool
}

var errBoom = errors.New("simulated request failure")

// interruptRequestOnWriter drives the pool's write connection through the
// prod-incident trigger using only public API: a WithTx whose body fails after
// its request ctx is canceled (client gone, timeout, shutdown). WithTx's plain
// ROLLBACK is interrupted; before the fix the connection then went back to the
// pool with the transaction still open.
func interruptRequestOnWriter(t *testing.T, pool *sqlitex.Pool) {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	conn, release, err := pool.WriteConn(ctx)
	require.NoError(t, err)

	err = sqlitex.WithTx(conn, func() error {
		if err := sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (0);", nil); err != nil {
			return err
		}
		cancel()
		return errBoom
	})
	require.Error(t, err, "WithTx must report the failure")

	release()
}

func setupLeakTable(t *testing.T, pool *sqlitex.Pool) {
	t.Helper()
	require.NoError(t, pool.WithTx(context.Background(), func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS leaktest (x int);", nil)
	}))
}

// commitLeakRow is the "innocent writer": it leases the write connection,
// inserts a row in a transaction, and is told it committed.
func commitLeakRow(t *testing.T, pool *sqlitex.Pool, x int64) {
	t.Helper()
	conn, release, err := pool.WriteConn(context.Background())
	require.NoError(t, err)
	err = sqlitex.WithTx(conn, func() error {
		return sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (?);", nil, x)
	})
	release()
	require.NoError(t, err, "the write was acknowledged")
}

func countLeakRows(t *testing.T, pool *sqlitex.Pool, x int64) int64 {
	t.Helper()
	var count int64
	require.NoError(t, pool.Query(context.Background(), func(c *sqlite.Conn) error {
		got, err := sqlitex.QueryOne[int64](c, "SELECT count(*) FROM leaktest WHERE x = ?", x)
		count = got
		return err
	}))
	return count
}

// TestWithTxInterruptedRollbackLeavesAutocommit pins the source fix: even when
// the caller's ctx is canceled mid-transaction (so WithTx's plain ROLLBACK is
// interrupted), WithTx must not return with the transaction still open, and it
// must surface the body's error rather than a rollback failure.
func TestWithTxInterruptedRollbackLeavesAutocommit(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	conn, release, err := pool.WriteConn(ctx)
	require.NoError(t, err)
	defer release()

	err = sqlitex.WithTx(conn, func() error {
		if err := sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (0);", nil); err != nil {
			return err
		}
		cancel()
		return errBoom
	})
	require.ErrorIs(t, err, errBoom,
		"with the transaction rolled back as promised, the body's error is the one to surface")
	require.True(t, conn.GetAutocommit(),
		"WithTx must never return with the transaction still open")
}

// TestWithTxInterruptedCommitRollsBack pins the commit-side of the source fix:
// a COMMIT that fails on a tripped interrupt never reached SQLite, so the
// transaction is still open when WithTx would return. WithTx must roll it back
// and report the failure — the write must be neither silently kept open nor
// half-committed.
func TestWithTxInterruptedCommitRollsBack(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	conn, release, err := pool.WriteConn(ctx)
	require.NoError(t, err)

	err = sqlitex.WithTx(conn, func() error {
		if err := sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (77);", nil); err != nil {
			return err
		}
		cancel() // trips the interrupt after the body succeeds, so COMMIT fails
		return nil
	})
	require.Error(t, err, "an uncommittable transaction must be reported as failed")
	require.True(t, conn.GetAutocommit(),
		"WithTx must never return with the transaction still open")
	release()

	require.EqualValues(t, 0, countLeakRows(t, pool, 77),
		"a transaction whose COMMIT failed must be rolled back, not linger uncommitted")
}

// TestPoolPutRepairsLeakedOpenTransaction pins the safety net independently of
// WithTx: a transaction left open on a connection by any code path (here a raw
// BEGIN IMMEDIATE) must be rolled back by Put, counted in LeakedTxRepairs, and
// invisible to the next lessee.
func TestPoolPutRepairsLeakedOpenTransaction(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)
	repairsBefore := sqlitex.LeakedTxRepairs()

	conn, release, err := pool.WriteConn(context.Background())
	require.NoError(t, err)
	require.NoError(t, sqlitex.Exec(conn, "BEGIN IMMEDIATE TRANSACTION;", nil))
	require.NoError(t, sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (13);", nil))
	release() // leaks the open transaction into the pool

	require.Equal(t, repairsBefore+1, sqlitex.LeakedTxRepairs(),
		"Put must repair and count the leaked transaction")

	conn, release, err = pool.WriteConn(context.Background())
	require.NoError(t, err)
	defer release()
	require.True(t, conn.GetAutocommit(),
		"the repaired connection must be in autocommit mode")

	require.EqualValues(t, 0, countLeakRows(t, pool, 13),
		"the leaked transaction's uncommitted write must be rolled back, not committed on the leaker's behalf")
}

// TestPoolPutMustNotRecycleOpenTransaction asserts the pool invariant through
// the prod trigger: after an interrupted request, a connection handed out by
// WriteConn must be in autocommit mode.
func TestPoolPutMustNotRecycleOpenTransaction(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	interruptRequestOnWriter(t, pool)

	conn, release, err := pool.WriteConn(context.Background())
	require.NoError(t, err)
	defer release()

	require.True(t, conn.GetAutocommit(),
		"pool handed out a write connection that is inside a leaked open transaction; every WithTx on it will silently become a savepoint")
}

// TestWithTxAcknowledgedWriteVisibleToReaders asserts the durability contract
// from the caller's point of view: if WithTx returns nil, the write must be
// visible to read connections. Before the fix the write landed inside the
// leaked transaction via the silent savepoint fallback: WithTx reported
// success, but readers could not see the row. This is exactly what the agents
// service hit: StoreBlobs returned the CIDs, and an immediate Resource read
// said not-found.
func TestWithTxAcknowledgedWriteVisibleToReaders(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	interruptRequestOnWriter(t, pool)

	commitLeakRow(t, pool, 42)

	require.EqualValues(t, 1, countLeakRows(t, pool, 42),
		"a write acknowledged by WithTx must be visible to read connections")
}

// TestWithTxAcknowledgedWriteSurvivesLeakedTxRollback reproduces the data-loss
// endgame: the acknowledged write must survive whatever later happens on the
// pooled connection. Before the fix a single ROLLBACK erased the acknowledged
// write hours after the caller was told it committed — on prod this destroyed
// every blob stored between 10:40 and 13:04.
func TestWithTxAcknowledgedWriteSurvivesLeakedTxRollback(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	interruptRequestOnWriter(t, pool)

	commitLeakRow(t, pool, 43)

	// Some later failure path issues a ROLLBACK on the same pooled connection
	// (in prod, whatever finally rolled back the leaked transaction ~2.5 hours
	// in). With a healthy pool there is no open transaction, so this errors
	// harmlessly; with a leaked transaction it would unwind everything nested
	// inside, including writes that were reported as committed.
	conn, release, err := pool.WriteConn(context.Background())
	require.NoError(t, err)
	_ = sqlitex.Exec(conn, "ROLLBACK;", nil)
	release()

	require.EqualValues(t, 1, countLeakRows(t, pool, 43),
		"an acknowledged write must survive later rollbacks on the pooled connection")
}

// TestPoolPutRepairsLeakedReadTransaction pins the repair on the read side of
// the pool, which the write-path tests do not cover. A read connection handed
// back mid-transaction is less dramatic than the writer — no acknowledged
// write is at stake — but it is not harmless: an open read transaction pins
// the WAL at its snapshot, so checkpointing cannot advance past it for as long
// as the connection sits in the pool, and the next lessee silently reads stale
// data from that snapshot instead of current state.
func TestPoolPutRepairsLeakedReadTransaction(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)
	repairsBefore := sqlitex.LeakedTxRepairs()

	conn, release, err := pool.ReadConn(context.Background())
	require.NoError(t, err)
	// A deferred BEGIN takes the connection out of autocommit; the SELECT
	// materialises the read snapshot it is pinned to.
	require.NoError(t, sqlitex.Exec(conn, "BEGIN;", nil))
	require.NoError(t, sqlitex.Exec(conn, "SELECT count(*) FROM leaktest;", nil))
	require.False(t, conn.GetAutocommit(), "precondition: the read tx is open")
	release() // leaks it into the read side of the pool

	require.Equal(t, repairsBefore+1, sqlitex.LeakedTxRepairs(),
		"Put must repair and count a leaked read transaction too")
	require.Zero(t, sqlitex.LeakedTxRepairFailures(),
		"the repair itself must not have failed")

	// Every read connection the pool can hand out must be clean. Lease the
	// whole read side at once so the repaired conn cannot hide behind a
	// healthy sibling.
	var releases []func()
	for range 3 {
		c, rel, err := pool.ReadConn(context.Background())
		require.NoError(t, err)
		require.True(t, c.GetAutocommit(),
			"pool handed out a read connection still inside a leaked transaction")
		releases = append(releases, rel)
	}
	for _, rel := range releases {
		rel()
	}
}

// TestPoolSurvivesRepeatedLeaks guards the property the previous panic-based
// repair would have broken: Put must always return the connection to the pool.
// Put runs inside net/http handler goroutines and singleflight, both of which
// recover panics, so a panic there would not crash the daemon — it would
// silently retire the pool's only write connection and every later writer
// would block in get() forever. Leaking repeatedly must leave the pool fully
// usable.
func TestPoolSurvivesRepeatedLeaks(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	for i := range 5 {
		interruptRequestOnWriter(t, pool)

		// The write connection must still be leasable and usable after each
		// leak. A stranded conn would hang here instead of failing.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		conn, release, err := pool.WriteConn(ctx)
		require.NoError(t, err, "write connection was not returned to the pool after leak %d", i)
		require.True(t, conn.GetAutocommit())
		require.NoError(t, sqlitex.WithTx(conn, func() error {
			return sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (?);", nil, int64(100+i))
		}))
		release()
		cancel()

		require.EqualValues(t, 1, countLeakRows(t, pool, int64(100+i)),
			"write after leak %d must be durable", i)
	}

	require.Zero(t, sqlitex.LeakedTxRepairFailures(),
		"no repair should have failed on a healthy connection")
}
