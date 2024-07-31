package backend

import (
	"context"
	"seed/backend/core"
	"seed/backend/daemon/index"
	storage "seed/backend/daemon/storage2"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"testing"

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

	blobs := index.NewIndex(db, log)
	require.NoError(t, blobs.Reindex(context.Background()))
}
