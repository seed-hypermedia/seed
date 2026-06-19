package storage

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

const testWALFlags = sqlite.SQLITE_OPEN_READWRITE |
	sqlite.SQLITE_OPEN_CREATE |
	sqlite.SQLITE_OPEN_WAL |
	sqlite.SQLITE_OPEN_URI |
	sqlite.SQLITE_OPEN_NOMUTEX

// TestWALCheckpointer verifies that the dedicated checkpointer flushes WAL
// frames that inline auto-checkpointing has been disabled for.
func TestWALCheckpointer(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "test.sqlite")

	w, err := sqlite.OpenConn(path, testWALFlags)
	require.NoError(t, err)
	defer func() { require.NoError(t, w.Close()) }()

	// Disable inline auto-checkpointing so the WAL accumulates frames until the
	// checkpointer flushes them — mirroring the Store's configuration.
	require.NoError(t, sqlitex.ExecTransient(w, "PRAGMA wal_autocheckpoint=0;", nil))
	require.NoError(t, sqlitex.ExecTransient(w, "CREATE TABLE t (x INTEGER);", nil))
	for i := range 500 {
		require.NoError(t, sqlitex.ExecTransient(w, "INSERT INTO t (x) VALUES (?);", nil, i))
	}

	c, err := newWALCheckpointer(path, time.Second, zap.NewNop())
	require.NoError(t, err)
	defer func() { require.NoError(t, c.Close()) }()

	busy, walFrames, checkpointed, err := c.checkpoint(checkpointPassive)
	require.NoError(t, err)
	require.Greater(t, walFrames, 0, "writes should have accumulated WAL frames (autocheckpoint off)")
	// No other connection holds a read mark, so PASSIVE should drain the WAL fully.
	require.Equal(t, 0, busy, "checkpoint should not be busy with no concurrent readers")
	require.Equal(t, walFrames, checkpointed, "PASSIVE should checkpoint every frame when unobstructed")
}

// TestWALCheckpointerTruncateReclaims verifies that a TRUNCATE checkpoint shrinks
// the WAL file on disk (PASSIVE flushes frames but leaves the file at its
// high-water mark; TRUNCATE is how the checkpointer reclaims that space).
func TestWALCheckpointerTruncateReclaims(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "test.sqlite")
	walPath := path + "-wal"

	w, err := sqlite.OpenConn(path, testWALFlags)
	require.NoError(t, err)
	defer func() { require.NoError(t, w.Close()) }()

	require.NoError(t, sqlitex.ExecTransient(w, "PRAGMA wal_autocheckpoint=0;", nil))
	require.NoError(t, sqlitex.ExecTransient(w, "CREATE TABLE t (x);", nil))
	for i := range 2000 {
		require.NoError(t, sqlitex.ExecTransient(w, "INSERT INTO t (x) VALUES (?);", nil, i))
	}

	grown, err := fileSize(walPath)
	require.NoError(t, err)
	require.Greater(t, grown, int64(0), "WAL should have grown on disk")

	c, err := newWALCheckpointer(path, time.Second, zap.NewNop())
	require.NoError(t, err)
	defer func() { require.NoError(t, c.Close()) }()

	busy, _, _, err := c.checkpoint(checkpointTruncate)
	require.NoError(t, err)
	require.Equal(t, 0, busy, "truncate should complete with no concurrent readers")

	shrunk, err := fileSize(walPath)
	require.NoError(t, err)
	require.Less(t, shrunk, grown, "TRUNCATE should shrink the WAL file")
}

func fileSize(path string) (int64, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return fi.Size(), nil
}

// TestWALCheckpointerLifecycle verifies start/Close run and that Close is
// idempotent (no panic on a double close).
func TestWALCheckpointerLifecycle(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "test.sqlite")

	// Materialize the db file first so the checkpointer connects to a real WAL db.
	w, err := sqlite.OpenConn(path, testWALFlags)
	require.NoError(t, err)
	require.NoError(t, sqlitex.ExecTransient(w, "CREATE TABLE t (x INTEGER);", nil))
	require.NoError(t, w.Close())

	c, err := newWALCheckpointer(path, 5*time.Millisecond, zap.NewNop())
	require.NoError(t, err)

	c.start()
	time.Sleep(30 * time.Millisecond) // let a few ticks fire

	require.NoError(t, c.Close())
	require.NoError(t, c.Close(), "Close must be idempotent")

	// checkpoint after Close is a no-op, not a use-after-close crash.
	busy, walFrames, checkpointed, err := c.checkpoint(checkpointPassive)
	require.NoError(t, err)
	require.Equal(t, 0, busy)
	require.Equal(t, 0, walFrames)
	require.Equal(t, 0, checkpointed)
}

// closerFunc adapts a function to io.Closer so tests can force a close failure.
type closerFunc func() error

func (f closerFunc) Close() error { return f() }

// TestErrClose verifies errClose joins (never drops) the original and close
// errors. The "close fails AND original err" case is the regression: the old
// implementation returned only the close error, silently dropping the original.
func TestErrClose(t *testing.T) {
	t.Parallel()

	orig := errors.New("setup failed")
	closeErr := errors.New("close failed")
	ok := closerFunc(func() error { return nil })
	bad := closerFunc(func() error { return closeErr })

	require.NoError(t, errClose(ok, nil), "no errors -> nil")

	require.ErrorIs(t, errClose(ok, orig), orig, "close ok -> original preserved")

	require.ErrorIs(t, errClose(bad, nil), closeErr, "no original -> close error surfaced")

	both := errClose(bad, orig)
	require.ErrorIs(t, both, orig, "close failed -> original must NOT be dropped")
	require.ErrorIs(t, both, closeErr, "close failed -> close error also reported")
}
