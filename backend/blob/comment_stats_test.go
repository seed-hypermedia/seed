package blob

import (
	"strings"
	"testing"

	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// TestCommentStatsQueriesSeek guards the shape of the maintenance queries.
//
// They run on the write path, once per indexed comment, so each has to cost about
// as much as one document's comments -- not as much as the database is big. Each
// gets there through an index that the query text has to keep provable: keying
// comment activity by genesis is only cheap because comment_live_by_genesis can be
// seeked, and a change that hides the genesis behind an expression or a join would
// still return the right answer, just slowly. Only the plan catches that.
func TestCommentStatsQueriesSeek(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	plan := func(t *testing.T, query string, args ...any) string {
		t.Helper()
		var sb strings.Builder
		require.NoError(t, sqlitex.ExecTransient(conn, "EXPLAIN QUERY PLAN "+strings.TrimSpace(query), func(stmt *sqlite.Stmt) error {
			sb.WriteString(stmt.ColumnText(3))
			sb.WriteString("\n")
			return nil
		}, args...))
		return sb.String()
	}

	t.Run("document stats seek comment_live by genesis", func(t *testing.T) {
		got := plan(t, qUpsertDocumentCommentStats(), "")
		require.Contains(t, got, "comment_live_by_genesis",
			"recomputing a document's comments must seek by genesis\nplan:\n%s", got)
		require.NotContains(t, got, "SCAN comment_live",
			"a full comment_live scan puts every comment in the database on the write path\nplan:\n%s", got)
	})

	t.Run("space stats seek resources by iri", func(t *testing.T) {
		got := plan(t, qUpsertSpaceCommentStats(), "")
		require.NotContains(t, got, "SCAN resources",
			"the space scope must seek the resources.iri index, not scan it\nplan:\n%s", got)
	})

	t.Run("live comment lookup seeks by tsid", func(t *testing.T) {
		got := plan(t, qInsertCommentLive(), "", "")
		require.Contains(t, got, "structural_blobs_by_tsid",
			"settling a TSID's live version must seek the tsid index\nplan:\n%s", got)
	})
}
