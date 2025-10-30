package syncing

import (
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/storage"
	"seed/backend/util/colx"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadExternalStore(t *testing.T) {
	t.Skip("This uses external database for local test only")
	t.Parallel()
	pool := loadLocalDB(t, "/home/julio/.config/Seed.bak/daemon/db/db.sqlite")
	store := rbsr.NewSliceStore()
	// Create RBSR store once for reuse across all peers.
	dKeys := colx.HashSet[discoveryKey]{
		discoveryKey{
			IRI: "hm://z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno/discussions/duplicated-discussion-ui",
		}: {},
	}
	err := pool.WithSave(t.Context(), func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, dKeys, store)
	})
	require.NoError(t, err)

}

func loadLocalDB(t testing.TB, path string) *sqlitex.Pool {
	t.Helper()

	pool, err := storage.OpenSQLite(path, 0, 6)

	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, pool.Close())
	})
	return pool
}
