package activity

import (
	"strings"
	"testing"

	"seed/backend/api/entities/v1alpha"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// TestFeedQueriesUseIndexedOrdering guards the ordering index the activity feed
// depends on.
//
// Both feed queries page with ORDER BY <cursor> DESC LIMIT :page_size. If no
// index can serve that ordering, SQLite has to build the *entire* result set in
// a temp b-tree before it can apply the LIMIT — for the main query that meant
// ~40k rows, each carrying the whole extra_attrs JSONB, to return 30. Measured
// on a 6.2 GB production database, that cost 175ms for the main query and 250ms
// for the mentions query, and it was ~10% of the daemon's total CPU.
//
// The plan assertions below are the cheap, stable way to catch a regression:
// adding a predicate that defeats structural_blobs_by_ts (say, wrapping ts in a
// function, or reintroducing a DISTINCT over the pre-LIMIT row set) silently
// restores the old cost, and no functional test would notice.
func TestFeedQueriesUseIndexedOrdering(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	plan := func(t *testing.T, query string) string {
		t.Helper()
		var sb strings.Builder
		// Trim: sqlite rejects anything after the statement's ";", and the
		// mentions constants carry a trailing newline.
		require.NoError(t, sqlitex.ExecTransient(conn, "EXPLAIN QUERY PLAN "+strings.TrimSpace(query), func(stmt *sqlite.Stmt) error {
			sb.WriteString(stmt.ColumnText(3))
			sb.WriteString("\n")
			return nil
		}))
		return sb.String()
	}

	// The mentions query is assembled the same way ListEvents does it: the
	// claimed-time order swaps the cursor column via this same Replace.
	claimedOrder := func(core string) string {
		return strings.Replace(core, "structural_blobs.id <= :idx", "structural_blobs.ts <= :idx", 1) + limitMentionsByClaimed
	}

	for _, tt := range []struct {
		name  string
		query string
		// drivenBy is the table the plan must start from, and it is the whole
		// point. Driving the mentions query from resource_links without a
		// selective filter meant scanning every link row in the database.
		drivenBy string
		// maySort is set for the one shape where an ORDER BY b-tree is the
		// right plan rather than a regression: see the comment below.
		maySort bool
	}{
		{name: "main/claimed", query: buildMainEventsQuery("", false), drivenBy: "structural_blobs"},
		{name: "main/observed", query: buildMainEventsQuery("", true), drivenBy: "structural_blobs"},
		{name: "mentions/claimed", query: claimedOrder(listMentionsCoreNoTargets), drivenBy: "structural_blobs"},
		{name: "mentions/observed", query: listMentionsCoreNoTargets + limitMentionsByObserved, drivenBy: "structural_blobs"},

		// The filtered variant is the exception. Its target IN(...) predicate is
		// selective, so seeking resource_links_by_target and sorting what comes
		// back beats walking structural_blobs in ts order and discarding almost
		// every row. The set it sorts is bounded by one document's inbound
		// links: at most 832 on a 6.2 GB production database, 9.6 on average,
		// which measured 4.5ms for the busiest target. What must not happen is
		// this shape falling back to driving from structural_blobs.
		{name: "mentions/claimed/filtered", query: claimedOrder(listMentionsCore), drivenBy: "resource_links", maySort: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := plan(t, tt.query)

			if !tt.maySort {
				require.NotContains(t, got, "USE TEMP B-TREE FOR ORDER BY",
					"query must page through an index, not sort every candidate row first\nplan:\n%s", got)
			}

			first, _, _ := strings.Cut(got, "\n")
			require.Contains(t, first, tt.drivenBy,
				"query must be driven by %s so the LIMIT stays bounded\nplan:\n%s", tt.drivenBy, got)
		})
	}
}

// TestMovedBlocksQueriesSeekRedirectIndex guards the index that resolves moved
// documents for every feed page and mentions listing. Driven by the plain
// genesis index, the lookup walked every blob sharing a genesis and parsed the
// redirect out of each row — thousands of rows per genesis on accounts whose
// documents share the home genesis, for every page served — and the moved-blocks
// query alone was 5% of the gateway's CPU. The partial index holds only
// redirecting Refs and covers the query.
func TestMovedBlocksQueriesSeekRedirectIndex(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	for _, tt := range []struct {
		name  string
		query string
	}{
		{name: "by genesis", query: entities.QGetMovedBlocks()},
		{name: "by resource filter", query: qGetMovedBlocksByResourceID()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var sb strings.Builder

			require.NoError(t, sqlitex.ExecTransient(conn, "EXPLAIN QUERY PLAN "+strings.TrimSpace(tt.query), func(stmt *sqlite.Stmt) error {
				sb.WriteString(stmt.ColumnText(3))
				sb.WriteString("\n")
				return nil
			}))
			got := sb.String()
			require.Contains(t, got, "INDEX structural_blobs_by_redirect (genesis_blob=?)",
				"moved-blocks lookup must seek the redirect index by genesis\nplan:\n%s", got)
			require.NotContains(t, got, "structural_blobs_by_genesis_blob", "plan:\n%s", got)
		})
	}
}
