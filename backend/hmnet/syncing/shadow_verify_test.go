package syncing

import (
	"context"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestShadowVerify_HealsDriftInPlace verifies the safety net end to end: a
// faithful maintained set passes untouched, and a set missing a blob
// (simulating a missed oracle edge) is detected AND re-materialized in the
// same sweep, staying materialized throughout — no serve required to heal.
func TestShadowVerify_HealsDriftInPlace(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	dkey := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
	ctx := context.Background()
	scopeID := materializeFixtureScope(t, db, dkey)

	next, stats, err := shadowVerifySweep(ctx, db, zap.NewNop(), 0, 10, time.Now())
	require.NoError(t, err)
	require.Equal(t, int64(0), next, "short page wraps the cursor")
	require.Equal(t, 1, stats.checked)
	require.Zero(t, stats.drifted, "faithful set must verify clean")
	require.Zero(t, stats.healed)

	// Corrupt the maintained set by dropping a blob it should contain.
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `DELETE FROM rbsr_item WHERE scope = ? AND blob = 11`, nil, scopeID)
	}))

	_, stats, err = shadowVerifySweep(ctx, db, zap.NewNop(), 0, 10, time.Now())
	require.NoError(t, err)
	require.Equal(t, 1, stats.drifted, "drift must be detected")
	require.Equal(t, 1, stats.healed, "drift must be healed in the same sweep")
	require.True(t, scopeMaterialized(t, db, scopeID), "healed scope stays materialized")
	require.True(t, itemInScope(t, db, scopeID, 11), "healed scope regains the missing blob")
}

// TestShadowVerify_HealsRottenScope: a scope stuck at materialized=0 (an
// interrupted materialization, or an older build's mark-stale) is healed
// directly by the sweep instead of waiting for its next serve.
func TestShadowVerify_HealsRottenScope(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	dkey := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
	ctx := context.Background()
	scopeID := materializeFixtureScope(t, db, dkey)

	// Simulate rot: stale-marked with a hole in its set, oracle no longer patching.
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `DELETE FROM rbsr_item WHERE scope = ? AND blob = 11`, nil, scopeID); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `UPDATE rbsr_scope SET materialized = 0 WHERE id = ?`, nil, scopeID)
	}))

	_, stats, err := shadowVerifySweep(ctx, db, zap.NewNop(), 0, 10, time.Now())
	require.NoError(t, err)
	require.Zero(t, stats.checked, "rotten scope heals directly, no verify needed")
	require.Equal(t, 1, stats.healed)
	require.True(t, scopeMaterialized(t, db, scopeID), "rotten scope is materialized again")
	require.True(t, itemInScope(t, db, scopeID, 11), "rotten scope regains the missing blob")
}

// TestShadowVerify_ContinuesPastFailure: one broken scope must not abort the
// pass — later scopes still get verified.
func TestShadowVerify_ContinuesPastFailure(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	ctx := context.Background()

	// Poisoned scope first (lowest id) so the healthy one comes after it in the
	// page: collectBlobs fails on the unparseable IRI.
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn,
			`INSERT INTO rbsr_scope (iri, kind, materialized, last_access) VALUES ('garbage', 2, 1, ?)`,
			nil, time.Now().Unix())
	}))
	materializeFixtureScope(t, db, DiscoveryKey{IRI: blob.IRI(base), Recursive: true})

	_, stats, err := shadowVerifySweep(ctx, db, zap.NewNop(), 0, 10, time.Now())
	require.NoError(t, err, "per-scope failure is not a pass failure")
	require.Equal(t, 1, stats.failed, "poisoned scope counted as failed")
	require.Equal(t, 1, stats.checked, "healthy scope after the failure still verified")
}

// TestShadowVerify_CursorPagingAndColdSkip: the trickle cursor pages through
// scopes in id order and wraps at the end; scopes idle past the cold horizon
// are skipped instead of verified.
func TestShadowVerify_CursorPagingAndColdSkip(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	ctx := context.Background()
	now := time.Now()

	first := materializeFixtureScope(t, db, DiscoveryKey{IRI: blob.IRI(base), Recursive: true})
	second := materializeFixtureScope(t, db, DiscoveryKey{IRI: blob.IRI(base + "/doc"), Recursive: true})

	// Page size 1: first tick verifies the first scope and leaves the cursor on it.
	next, stats, err := shadowVerifySweep(ctx, db, zap.NewNop(), 0, 1, now)
	require.NoError(t, err)
	require.Equal(t, first, next)
	require.Equal(t, 1, stats.checked)

	// Second tick continues from the cursor.
	next, stats, err = shadowVerifySweep(ctx, db, zap.NewNop(), next, 1, now)
	require.NoError(t, err)
	require.Equal(t, second, next)
	require.Equal(t, 1, stats.checked)

	// A full page can't know it hit the end; the next (empty) tick wraps.
	next, stats, err = shadowVerifySweep(ctx, db, zap.NewNop(), next, 1, now)
	require.NoError(t, err)
	require.Equal(t, int64(0), next)
	require.Zero(t, stats.checked)

	// A scope idle past the cold horizon is skipped, not verified.
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `UPDATE rbsr_scope SET last_access = ? WHERE id = ?`,
			nil, now.Add(-shadowVerifyColdAfter-time.Hour).Unix(), second)
	}))
	_, stats, err = shadowVerifySweep(ctx, db, zap.NewNop(), 0, 10, now)
	require.NoError(t, err)
	require.Equal(t, 1, stats.checked)
	require.Equal(t, 1, stats.skipped, "cold scope is skipped")
}

func materializeFixtureScope(t *testing.T, db *sqlitex.Pool, dkey DiscoveryKey) int64 {
	t.Helper()
	var scopeID int64
	require.NoError(t, db.WithTx(context.Background(), func(conn *sqlite.Conn) error {
		id, _, err := resolveScope(conn, dkey)
		if err != nil {
			return err
		}
		scopeID = id
		return materializeScope(conn, id, dkey)
	}))
	return scopeID
}

func scopeMaterialized(t *testing.T, db *sqlitex.Pool, scopeID int64) bool {
	t.Helper()
	var materialized bool
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `SELECT materialized FROM rbsr_scope WHERE id = ?`, func(stmt *sqlite.Stmt) error {
			materialized = stmt.ColumnInt64(0) != 0
			return nil
		}, scopeID)
	}))
	return materialized
}

func itemInScope(t *testing.T, db *sqlitex.Pool, scopeID, blobID int64) bool {
	t.Helper()
	var found bool
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `SELECT 1 FROM rbsr_item WHERE scope = ? AND blob = ?`, func(stmt *sqlite.Stmt) error {
			found = true
			return nil
		}, scopeID, blobID)
	}))
	return found
}
