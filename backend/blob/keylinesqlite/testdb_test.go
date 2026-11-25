package keylinesqlite

import (
	"testing"

	"seed/backend/storage"
	"seed/backend/storage/dbext"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// OpenTestDB opens a pool at path with Seed's schema, creating it on first
// use. Foreign keys stay off, SQLite's default, so tests can cite blob IDs
// without storing blobs; a test that checks references turns them on and
// stores the blobs it cites. The caller closes the pool.
func OpenTestDB(t testing.TB, path string, poolSize int) *sqlitex.Pool {
	t.Helper()
	require.NoError(t, dbext.LoadExtensions())
	db, err := sqlitex.Open(path, 0, poolSize)
	require.NoError(t, err)
	conn, release, err := db.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()
	initTestSchema(t, conn)
	return db
}

// OpenTestConn is OpenTestDB for a single connection.
func OpenTestConn(t testing.TB, path string) *sqlite.Conn {
	t.Helper()
	require.NoError(t, dbext.LoadExtensions())
	conn, err := sqlite.OpenConn(path, 0)
	require.NoError(t, err)
	initTestSchema(t, conn)
	return conn
}

func initTestSchema(t testing.TB, conn *sqlite.Conn) {
	t.Helper()
	exists, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM sqlite_schema WHERE name = 'keyline_nodes'")
	require.NoError(t, err)

	if exists == 0 {
		require.NoError(t, storage.InitSQLiteSchema(conn))
	}
}

// storeTestBlobs stores a placeholder blob for each ID, so facts citing them
// satisfy foreign keys.
func storeTestBlobs(t testing.TB, conn *sqlite.Conn, ids ...int64) {
	t.Helper()
	for _, id := range ids {
		require.NoError(t, sqlitex.Exec(conn, "INSERT OR IGNORE INTO blobs (id, multihash, codec, size) VALUES (?1, CAST(?1 AS BLOB), 85, 0)", nil, id))
	}
}
