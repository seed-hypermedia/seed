package blob

import (
	"strings"
	"testing"

	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
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

	t.Run("pending comments by target change seek the backlinks index", func(t *testing.T) {
		got := plan(t, qPendingCommentsTargetingChange(), 0)
		require.Contains(t, got, "blob_backlinks",
			"finding the comments pinned to a change must seek blob_links by target\nplan:\n%s", got)
		require.Contains(t, got, "SEARCH sb USING PRIMARY KEY (id=?)",
			"backlink sources must seek blob IDs, not filter a scan of all comments\nplan:\n%s", got)
		require.NotContains(t, got, "SCAN structural_blobs",
			"a structural_blobs scan on every indexed change puts the whole database on the write path\nplan:\n%s", got)
		require.Contains(t, got, "SEARCH latest USING INDEX structural_blobs_by_tsid",
			"the latest-version subquery must seek by comment identity, not scan all comments\nplan:\n%s", got)
	})

	t.Run("pending comments by resource seek structural_blobs by resource", func(t *testing.T) {
		got := plan(t, qPendingCommentsOnResource(), 0)
		require.Contains(t, got, "structural_blobs_by_resource",
			"finding a path's unsettled comments must seek by resource\nplan:\n%s", got)
		require.Contains(t, got, "SEARCH latest USING INDEX structural_blobs_by_tsid",
			"the latest-version subquery must seek by comment identity, not scan all comments\nplan:\n%s", got)
	})

	t.Run("live comment lookup seeks by tsid", func(t *testing.T) {
		got := plan(t, qInsertCommentLive(), "", "")
		require.Contains(t, got, "structural_blobs_by_tsid",
			"settling a TSID's live version must seek the tsid index\nplan:\n%s", got)
	})
}

func TestDeletedCommentDoesNotResettleOnRef(t *testing.T) {
	t.Parallel()
	alice := coretest.NewTester("alice")
	clock := cclock.New()
	change, err := NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	ref, err := NewRef(alice.Account, 0, change.CID, alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)
	comment, err := NewComment(alice.Account, "", alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, cid.Undef, cid.Undef,
		[]CommentBlock{{Block: Block{Type: "paragraph", Text: "hello"}}}, VisibilityPublic, clock.MustNow())
	require.NoError(t, err)
	tombstone, err := NewComment(alice.Account, comment.TSID(), alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, cid.Undef, cid.Undef, nil, VisibilityPublic, clock.MustNow())
	require.NoError(t, err)

	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{change, ref, comment, tombstone}))
	for range 3 {
		nextRef, err := NewRef(alice.Account, 0, change.CID, alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
		require.NoError(t, err)
		require.NoError(t, idx.Put(t.Context(), nextRef))
	}
	count, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT comment_count FROM document_generations")
	require.NoError(t, err)
	require.Zero(t, count, "later Refs must not replay a deleted comment's count increment")
}

func TestPendingCommentsSelectLatestLiveVersion(t *testing.T) {
	t.Parallel()
	alice := coretest.NewTester("alice")
	clock := cclock.New()
	change, err := NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	ref, err := NewRef(alice.Account, 0, change.CID, alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)
	body := []CommentBlock{{Block: Block{Type: "paragraph", Text: "hello"}}}

	for _, pinned := range []bool{true, false} {
		name := "unpinned"
		var version []cid.Cid
		if pinned {
			name = "pinned"
			version = []cid.Cid{change.CID}
		}
		t.Run(name, func(t *testing.T) {
			original, err := NewComment(alice.Account, "", alice.Account.Principal(), "/doc", version, cid.Undef, cid.Undef, body, VisibilityPublic, clock.MustNow())
			require.NoError(t, err)
			edit, err := NewComment(alice.Account, original.TSID(), alice.Account.Principal(), "/doc", version, cid.Undef, cid.Undef, body, VisibilityPublic, clock.MustNow())
			require.NoError(t, err)
			deleted, err := NewComment(alice.Account, original.TSID(), alice.Account.Principal(), "/doc", version, cid.Undef, cid.Undef, nil, VisibilityPublic, clock.MustNow())
			require.NoError(t, err)
			restored, err := NewComment(alice.Account, original.TSID(), alice.Account.Principal(), "/doc", version, cid.Undef, cid.Undef, body, VisibilityPublic, clock.MustNow())
			require.NoError(t, err)

			for _, tt := range []struct {
				name     string
				comments []blocks.Block
				wantLive int
			}{
				{"edited", []blocks.Block{original, edit}, 1},
				{"edit first", []blocks.Block{edit, original}, 1},
				{"deleted", []blocks.Block{original, deleted}, 0},
				{"tombstone first", []blocks.Block{deleted, original}, 0},
				{"restored", []blocks.Block{restored, deleted, original}, 1},
			} {
				t.Run(tt.name, func(t *testing.T) {
					db := storage.MakeTestDB(t)
					idx, err := OpenIndex(t.Context(), db, zap.NewNop())
					require.NoError(t, err)
					require.NoError(t, idx.PutMany(t.Context(), tt.comments))

					conn, release, err := db.ReadConn(t.Context())
					require.NoError(t, err)
					resource, err := sqlitex.QueryOne[int64](conn, "SELECT resource FROM structural_blobs WHERE type = 'Comment' LIMIT 1")
					require.NoError(t, err)
					count := 0
					err = sqlitex.Exec(conn, qPendingCommentsOnResource(), func(*sqlite.Stmt) error { count++; return nil }, resource)
					require.NoError(t, err)
					release()
					require.Equal(t, tt.wantLive, count, "retry once per live comment identity")

					require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{change, ref}))
					live, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT COUNT(*) FROM comment_live")
					require.NoError(t, err)
					require.Equal(t, tt.wantLive, live)
				})
			}
		})
	}
}
