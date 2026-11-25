package sqlite_test

import (
	"path/filepath"
	"testing"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// fillAndScan creates a table of about 4 MiB of blobs on a fresh connection
// and reads every byte of it, so the connection's page cache ends up holding
// the table unless something stops it from growing.
func fillAndScan(t *testing.T, conn *sqlite.Conn) {
	t.Helper()
	for _, stmt := range []string{
		"PRAGMA cache_size = -16384;",
		"CREATE TABLE t (v BLOB);",
		"WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1024) INSERT INTO t SELECT randomblob(4000) FROM n;",
		"SELECT total(length(hex(v))) FROM t;",
	} {
		require.NoError(t, sqlitex.ExecTransient(conn, stmt, nil))
	}
}

func TestMemoryStats(t *testing.T) {
	conn, err := sqlite.OpenConn(filepath.Join(t.TempDir(), "db.sqlite"), 0)
	require.NoError(t, err)
	defer conn.Close()

	fillAndScan(t, conn)

	cs := conn.CacheStats()
	require.Greater(t, cs.UsedBytes, int64(3<<20), "the cache holds the table")
	require.Positive(t, cs.Hits+cs.Misses)
	require.Positive(t, sqlite.MemoryUsed())
	require.GreaterOrEqual(t, sqlite.MemoryHighwater(false), sqlite.MemoryUsed())

	require.NoError(t, sqlitex.ExecTransient(conn, "PRAGMA shrink_memory;", nil))
	require.Less(t, conn.CacheStats().UsedBytes, int64(1<<20), "shrink_memory frees the cache")
}

func TestSoftHeapLimit(t *testing.T) {
	// The limit is process-wide: no t.Parallel, and put it back afterwards.
	prev := sqlite.SetSoftHeapLimit(0)
	defer sqlite.SetSoftHeapLimit(prev)

	conn, err := sqlite.OpenConn(filepath.Join(t.TempDir(), "db.sqlite"), 0)
	require.NoError(t, err)
	defer conn.Close()

	fillAndScan(t, conn)
	require.Greater(t, conn.CacheStats().UsedBytes, int64(3<<20), "without a limit the scan fills the cache")
	require.NoError(t, sqlitex.ExecTransient(conn, "PRAGMA shrink_memory;", nil))

	limit := sqlite.MemoryUsed() + 1<<20
	require.Zero(t, sqlite.SetSoftHeapLimit(limit))
	require.Equal(t, limit, sqlite.SoftHeapLimit())

	require.NoError(t, sqlitex.ExecTransient(conn, "SELECT total(length(hex(v))) FROM t;", nil))
	require.Less(t, conn.CacheStats().UsedBytes, int64(2<<20), "above the limit the cache recycles pages instead of growing")
}
