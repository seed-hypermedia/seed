package sqlitex_test

import (
	"context"
	"errors"
	"testing"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// These tests reproduce the acknowledged-write blackhole observed on prod
// hyper.media on 2026-07-24 (10:40-13:04 UTC), where ~2.5 hours of writes that
// StoreBlobs had acknowledged were silently rolled back without any daemon
// restart. The failure is a composition of three behaviors:
//
//  1. WithTx's error path runs ROLLBACK; if that ROLLBACK itself fails — which
//     is guaranteed when the caller's ctx was canceled, because the binding
//     fails every call on a tripped interrupt before reaching SQLite — the
//     connection is left inside the open transaction (tx.go).
//  2. Pool.Put checks for unreset statements (checkReset) but never checks
//     sqlite3_get_autocommit(), so the poisoned connection re-enters the pool
//     with its transaction still open (pool.go).
//  3. WithTx's nested-transaction fallback silently converts subsequent
//     "transactions" on that connection into savepoints (tx.go). Every later
//     writer that leases the single pooled write connection reports success,
//     but its data is invisible to read connections and is destroyed wholesale
//     when the leaked outer transaction eventually rolls back.
//
// The fix should ensure a connection returned to the pool is never inside a
// transaction: repair it (rollback + log loudly) or refuse to recycle it.
// Panicking in Put would be wrong — interrupts are a normal part of request
// cancellation, which is exactly how the leak starts.

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

// leakOpenTxOnWriter drives the pool's write connection through the
// interrupted-rollback sequence using only public API: a WithTx whose body
// fails after its request ctx is canceled. WithTx's internal ROLLBACK is
// interrupted, so the connection goes back to the pool with the transaction
// still open. This is the exact prod trigger (a canceled/interrupted request on
// the daemon's single writer connection).
func leakOpenTxOnWriter(t *testing.T, pool *sqlitex.Pool) {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	conn, release, err := pool.WriteConn(ctx)
	require.NoError(t, err)

	errBoom := errors.New("simulated request failure")
	err = sqlitex.WithTx(conn, func() error {
		if err := sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (0);", nil); err != nil {
			return err
		}
		// The request's ctx is canceled mid-transaction (client gone, timeout,
		// shutdown). Every subsequent call on this conn — including WithTx's
		// own ROLLBACK — now fails with SQLITE_INTERRUPT.
		cancel()
		return errBoom
	})
	require.Error(t, err, "WithTx must report the failure")

	// Returning the connection to the pool is where the leak happens: Put does
	// not notice the open transaction.
	release()
}

func setupLeakTable(t *testing.T, pool *sqlitex.Pool) {
	t.Helper()
	require.NoError(t, pool.WithTx(context.Background(), func(c *sqlite.Conn) error {
		return sqlitex.Exec(c, "CREATE TABLE IF NOT EXISTS leaktest (x int);", nil)
	}))
}

// TestPoolPutMustNotRecycleOpenTransaction asserts the pool invariant directly:
// a connection handed out by WriteConn must be in autocommit mode. Today the
// leaked transaction survives Put and the next lessee silently inherits it.
func TestPoolPutMustNotRecycleOpenTransaction(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	leakOpenTxOnWriter(t, pool)

	conn, release, err := pool.WriteConn(context.Background())
	require.NoError(t, err)
	defer release()

	require.True(t, conn.GetAutocommit(),
		"pool handed out a write connection that is inside a leaked open transaction; every WithTx on it will silently become a savepoint")
}

// TestWithTxAcknowledgedWriteVisibleToReaders asserts the durability contract
// from the caller's point of view: if WithTx returns nil, the write must be
// visible to read connections. Today the write lands inside the leaked
// transaction via the silent savepoint fallback: WithTx reports success, but
// readers cannot see the row. This is exactly what the agents service hit:
// StoreBlobs returned the CIDs, and an immediate Resource read said not-found.
func TestWithTxAcknowledgedWriteVisibleToReaders(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	leakOpenTxOnWriter(t, pool)

	// An innocent writer: leases the (poisoned) write connection, does a
	// transaction, and is told it committed.
	conn, release, err := pool.WriteConn(context.Background())
	require.NoError(t, err)
	err = sqlitex.WithTx(conn, func() error {
		return sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (42);", nil)
	})
	release()
	require.NoError(t, err, "the write was acknowledged")

	var count int64
	require.NoError(t, pool.Query(context.Background(), func(c *sqlite.Conn) error {
		got, err := sqlitex.QueryOne[int64](c, "SELECT count(*) FROM leaktest WHERE x = 42")
		count = got
		return err
	}))
	require.EqualValues(t, 1, count,
		"a write acknowledged by WithTx must be visible to read connections; it is trapped inside a leaked transaction another caller left open")
}

// TestWithTxAcknowledgedWriteSurvivesLeakedTxRollback reproduces the data-loss
// endgame: the acknowledged write must survive whatever later happens to the
// leaked outer transaction. Today a single ROLLBACK on the poisoned connection
// erases the acknowledged write hours after the caller was told it committed —
// on prod this destroyed every blob stored between 10:40 and 13:04.
func TestWithTxAcknowledgedWriteSurvivesLeakedTxRollback(t *testing.T) {
	pool := newFilePool(t)
	setupLeakTable(t, pool)

	leakOpenTxOnWriter(t, pool)

	conn, release, err := pool.WriteConn(context.Background())
	require.NoError(t, err)
	err = sqlitex.WithTx(conn, func() error {
		return sqlitex.Exec(conn, "INSERT INTO leaktest (x) VALUES (43);", nil)
	})
	release()
	require.NoError(t, err, "the write was acknowledged")

	// Some later failure path issues a ROLLBACK on the same pooled connection
	// (in prod, whatever finally rolled back the leaked transaction ~2.5 hours
	// in). With a healthy pool there is no open transaction, so this errors and
	// is harmless; with the leaked transaction it unwinds everything nested
	// inside, including writes that were reported as committed.
	conn, release, err = pool.WriteConn(context.Background())
	require.NoError(t, err)
	_ = sqlitex.Exec(conn, "ROLLBACK;", nil)
	release()

	var count int64
	require.NoError(t, pool.Query(context.Background(), func(c *sqlite.Conn) error {
		got, err := sqlitex.QueryOne[int64](c, "SELECT count(*) FROM leaktest WHERE x = 43")
		count = got
		return err
	}))
	require.EqualValues(t, 1, count,
		"an acknowledged write was silently destroyed by the rollback of a transaction leaked into the pool")
}
