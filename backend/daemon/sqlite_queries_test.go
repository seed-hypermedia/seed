package daemon

import (
	storage "seed/backend/daemon/storage2"
	"seed/backend/pkg/dqb"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDBQueries(t *testing.T) {
	// This test is here because this is the most top-level package which we know
	// imports all other packages that might have database queries. So all these
	// queries would have been registered with the global query store in the dqb package.
	// This test makes sure all queries are valid and use correct table and column names.

	t.Skip("TODO(hm24)")

	t.Parallel()

	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, storage.InitSQLiteSchema(db))
	require.NoError(t, dqb.GlobalQueries.Test(db))
}
