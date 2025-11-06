package backend

import (
	"context"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestDBMigrateManual(t *testing.T) {
	// This is a convenience manual test
	// to verify the database migrations and indexing.
	// Before running the test duplicate your entire production data directory to /tmp/seed-db-migrate-test.
	testutil.Manual(t)

	dir, err := storage.Open("/tmp/seed-db-migrate-test", nil, core.NewMemoryKeyStore(), "debug")
	require.NoError(t, err)
	defer dir.Close()

	db := dir.DB()

	log := must.Do2(zap.NewDevelopment())

	blobs := must.Do2(blob.OpenIndex(context.Background(), db, log))
	require.NoError(t, blobs.Reindex(context.Background()))
}

func TestSlow(t *testing.T) {
	dir, err := storage.Open(t.TempDir(), nil, core.NewMemoryKeyStore(), "debug")
	require.NoError(t, err)
	defer dir.Close()

	err = dir.DB().WithTx(t.Context(), func(conn *sqlite.Conn) error {
		time.Sleep(12 * time.Second)
		return nil
	})
	require.NoError(t, err)
}
