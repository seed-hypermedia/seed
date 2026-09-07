package blob

import (
	"strings"
	"testing"

	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// TestCommentStatsWalksSeek guards the shape of the two redirect walks in
// updateResourceCommentStats.
//
// Both run on the write path, once per indexed comment and once per redirect, so
// they have to cost about as much as the chain is long — not as much as the
// database is big. Both get there only because of a specific formulation, and
// both silently fall back to scanning every redirect attribute in the database if
// that formulation is disturbed:
//
//   - forward: the target is read through a correlated subquery, which is the only
//     shape where the planner uses document_attributes' (resource, key) key;
//   - backward: a CROSS JOIN pins the walk as the driver, so the three-column
//     document_attributes_by_key index is probed on value as well as (key, kind).
//
// Written as ordinary joins both plans still return the right answer, so only the
// plan catches the regression.
func TestCommentStatsWalksSeek(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	for _, tt := range []struct {
		name  string
		query string
	}{
		{"delete", qDeleteResourceCommentStats()},
		{"insert", qInsertResourceCommentStats()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var sb strings.Builder
			require.NoError(t, sqlitex.ExecTransient(conn, "EXPLAIN QUERY PLAN "+strings.TrimSpace(tt.query), func(stmt *sqlite.Stmt) error {
				sb.WriteString(stmt.ColumnText(3))
				sb.WriteString("\n")
				return nil
			}, 0))
			plan := sb.String()

			require.Contains(t, plan, "SEARCH da USING PRIMARY KEY (resource=? AND key=?)",
				"the forward redirect walk must seek document_attributes by resource\nplan:\n%s", plan)

			if tt.name == "insert" {
				require.Contains(t, plan, "document_attributes_by_key (key=? AND kind=? AND value=?)",
					"the backward redirect walk must seek on the redirect target's IRI, not scan every redirect\nplan:\n%s", plan)
			}

			require.NotContains(t, plan, "SCAN document_attributes",
				"a full document_attributes scan puts the whole database on the write path\nplan:\n%s", plan)
		})
	}
}
