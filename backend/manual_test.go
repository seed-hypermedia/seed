package backend

import (
	"context"
	documentsv3 "seed/backend/api/documents/v3alpha"
	"seed/backend/blob"
	"seed/backend/core/keystore"
	"seed/backend/storage"
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
	//
	// Run with -cpuprofile to profile the reindex:
	//   go test ./backend -run TestDBMigrateManual -timeout 60m -v -cpuprofile /tmp/reindex.prof
	testutil.Manual(t)

	dir, err := storage.Open("/tmp/seed-db-migrate-test", nil, keystore.NewMemory(), "debug")
	require.NoError(t, err)
	defer dir.Close()

	db := dir.DB()

	log := must.Do2(zap.NewDevelopment())

	// OpenIndexPendingReindex, not OpenIndex: storage.Open above already ran the
	// migrations, and any migration that calls scheduleReindex leaves
	// last_reindex_time blank — so OpenIndex's inner MaybeReindex would reindex
	// once and the explicit Reindex below would do it all over again. Timings and
	// profiles taken across two passes are meaningless.
	blobs := blob.OpenIndexPendingReindex(db, log)

	// The daemon wires this before the reindex task starts (see daemon.Load), and
	// the reindex derives fallback cover images for every document generation.
	// Without it the deriver is nil and this test silently skips that work,
	// i.e. it does not reproduce what actually runs in production.
	blobs.SetDeriveFirstContentImage(documentsv3.DeriveFirstContentImage)

	require.NoError(t, blobs.Reindex(context.Background()))
}
