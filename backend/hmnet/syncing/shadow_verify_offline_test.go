package syncing

import (
	"context"
	"os"
	"testing"
	"time"

	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestShadowVerify_OfflineSweepAgainstRealDB is an ops diagnostic, skipped
// unless SEED_SLIM_DB points at a (slim) copy of a real daemon database — see
// the drift-differ notes in the sync docs: a slim copy carries every metadata
// table but NULLs blobs.data. It runs full trickle rotations over every real
// scope, requiring that (1) no scope errors, (2) everything drifted heals, and
// (3) a second rotation finds zero drift — i.e. the maintained index converges
// to collectBlobs on real-world data, not just fixtures.
//
// Usage:
//
//	SEED_SLIM_DB=/path/to/slim.sqlite go test ./backend/hmnet/syncing/ -run OfflineSweep -v
func TestShadowVerify_OfflineSweepAgainstRealDB(t *testing.T) {
	path := os.Getenv("SEED_SLIM_DB")
	if path == "" {
		t.Skip("SEED_SLIM_DB not set; this is an offline ops diagnostic")
	}

	pool, err := storage.OpenSQLite("file:"+path, 0, 4)
	require.NoError(t, err)
	defer pool.Close()

	ctx := context.Background()

	// Warm every scope so the cold-skip doesn't hide any from verification.
	require.NoError(t, pool.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `UPDATE rbsr_scope SET last_access = ?`, nil, time.Now().Unix())
	}))

	rotate := func() (total shadowVerifyStats) {
		var cursor int64
		for {
			next, stats, err := shadowVerifySweep(ctx, pool, zap.NewNop(), cursor, 100, time.Now())
			require.NoError(t, err)
			total.checked += stats.checked
			total.drifted += stats.drifted
			total.healed += stats.healed
			total.failed += stats.failed
			total.skipped += stats.skipped
			total.evicted += stats.evicted
			cursor = next
			if cursor == 0 {
				return total
			}
		}
	}

	first := rotate()
	t.Logf("rotation 1: checked=%d drifted=%d healed=%d failed=%d skipped=%d",
		first.checked, first.drifted, first.healed, first.failed, first.skipped)
	require.Zero(t, first.failed, "no scope may error on real data")

	second := rotate()
	t.Logf("rotation 2: checked=%d drifted=%d healed=%d failed=%d skipped=%d",
		second.checked, second.drifted, second.healed, second.failed, second.skipped)
	require.Zero(t, second.failed, "no scope may error after healing")
	require.Zero(t, second.drifted, "everything must converge after one healing rotation")
	require.Zero(t, second.healed, "nothing left to heal on the second rotation")
}
