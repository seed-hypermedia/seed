package syncing

import (
	"context"
	"testing"

	"seed/backend/blob"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// TestShadowVerify_DetectsDriftAndMarksStale verifies the safety net: a faithful
// maintained set passes, but a set missing a blob (simulating a missed oracle
// edge) is detected and the scope is forced to re-materialize.
func TestShadowVerify_DetectsDriftAndMarksStale(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	dkey := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
	ctx := context.Background()

	var scopeID int64
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		id, _, err := resolveScope(conn, dkey)
		if err != nil {
			return err
		}
		scopeID = id
		return materializeScope(conn, id, dkey)
	}))

	// A faithfully materialized scope must verify clean and stay materialized.
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		ok, err := shadowVerifyScope(conn, scopeID, dkey)
		require.NoError(t, err)
		require.True(t, ok, "faithful set must verify clean")
		return nil
	}))
	require.True(t, scopeMaterialized(t, db, scopeID), "clean scope stays materialized")

	// Corrupt the maintained set by dropping a blob it should contain.
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `DELETE FROM rbsr_item WHERE scope = ? AND blob = 11`, nil, scopeID)
	}))

	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		ok, err := shadowVerifyScope(conn, scopeID, dkey)
		require.NoError(t, err)
		require.False(t, ok, "drift must be detected")
		return nil
	}))
	require.False(t, scopeMaterialized(t, db, scopeID), "drifted scope is marked for re-materialization")
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
