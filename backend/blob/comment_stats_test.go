package blob

import (
	"regexp"
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
// comment activity by genesis is only cheap because comments_live_by_genesis can be
// seeked, and a change that hides the genesis behind an expression or a join would
// still return the right answer, just slowly. Only the plan catches that.
func TestCommentStatsQueriesSeek(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	// A plan step on the blobs table itself, by name or by a short alias.
	readsBlobsTable := regexp.MustCompile(`(?m)^(SEARCH|SCAN) (blobs|b|lb|version)\b`)

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

	t.Run("document stats seek comments_live by genesis", func(t *testing.T) {
		got := plan(t, qUpsertDocumentCommentStats(), "")
		require.Contains(t, got, "comments_live_by_genesis",
			"recomputing a document's comments must seek by genesis\nplan:\n%s", got)
		require.NotContains(t, got, "SCAN comments_live",
			"a full comments_live scan puts every comment in the database on the write path\nplan:\n%s", got)
	})

	t.Run("live winner comes from the tsid index without a sort or a blobs read", func(t *testing.T) {
		got := plan(t, qInsertCommentLive(), []byte{}, "")
		require.Contains(t, got, "structural_blobs_by_tsid",
			"picking a comment's live version must seek its versions by identity\nplan:\n%s", got)
		require.NotContains(t, got, "TEMP B-TREE",
			"the (ts, hash) order must come from the index, not a sort\nplan:\n%s", got)
		require.NotRegexp(t, readsBlobsTable, got,
			"the tie-break must not read the blobs table\nplan:\n%s", got)
	})

	t.Run("document stats order the latest comment from the genesis index", func(t *testing.T) {
		got := plan(t, qUpsertDocumentCommentStats(), "")
		require.NotRegexp(t, readsBlobsTable, got,
			"the latest-comment tie-break must not read the blobs table\nplan:\n%s", got)
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

func TestDeletedCommentStaysUncountedAfterRefs(t *testing.T) {
	t.Parallel()
	alice := coretest.NewTester("alice")
	clock := cclock.New()
	change, err := NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	ref, err := NewRef(alice.Account, 0, change.CID, alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)
	comment, err := NewComment(alice.Account, "", alice.Account.Principal(), alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, cid.Undef, cid.Undef,
		[]CommentBlock{{Block: Block{Type: "paragraph", Text: "hello"}}}, VisibilityPublic, clock.MustNow())
	require.NoError(t, err)
	tombstone, err := NewComment(alice.Account, comment.TSID(), alice.Account.Principal(), alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, cid.Undef, cid.Undef, nil, VisibilityPublic, clock.MustNow())
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
	count, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT COALESCE(SUM(comment_count), 0) FROM document_comment_stats")
	require.NoError(t, err)
	require.Zero(t, count, "later Refs must not count a deleted comment again")
}

func TestStashedCommentVersionsSettleLatestLive(t *testing.T) {
	t.Parallel()
	alice := coretest.NewTester("alice")
	clock := cclock.New()
	change, err := NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{}, clock.MustNow())
	require.NoError(t, err)
	ref, err := NewRef(alice.Account, 0, change.CID, alice.Account.Principal(), "/doc", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)
	body := []CommentBlock{{Block: Block{Type: "paragraph", Text: "hello"}}}

	version := []cid.Cid{change.CID}
	original, err := NewComment(alice.Account, "", alice.Account.Principal(), alice.Account.Principal(), "/doc", version, cid.Undef, cid.Undef, body, VisibilityPublic, clock.MustNow())
	require.NoError(t, err)
	edit, err := NewComment(alice.Account, original.TSID(), alice.Account.Principal(), alice.Account.Principal(), "/doc", version, cid.Undef, cid.Undef, body, VisibilityPublic, clock.MustNow())
	require.NoError(t, err)
	deleted, err := NewComment(alice.Account, original.TSID(), alice.Account.Principal(), alice.Account.Principal(), "/doc", version, cid.Undef, cid.Undef, nil, VisibilityPublic, clock.MustNow())
	require.NoError(t, err)
	restored, err := NewComment(alice.Account, original.TSID(), alice.Account.Principal(), alice.Account.Principal(), "/doc", version, cid.Undef, cid.Undef, body, VisibilityPublic, clock.MustNow())
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

			// Comments wait in the stash until the changes they name arrive.
			stashed, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT COUNT(*) FROM stashed_blobs WHERE reason = 'FailedPrecondition'")
			require.NoError(t, err)
			require.Equal(t, len(tt.comments), stashed)

			require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{change, ref}))
			live, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT COUNT(*) FROM comments_live")
			require.NoError(t, err)
			require.Equal(t, tt.wantLive, live)
		})
	}
}

// Recounting a space without comments doesn't create its row, as a rolled-back
// comment would otherwise leave an empty space behind. An existing row is
// still reset.
func TestSpaceCommentStatsCreateNoEmptySpace(t *testing.T) {
	db := storage.MakeTestDB(t)
	conn, release, err := db.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()

	require.NoError(t, updateSpaceCommentStats(conn, "absent"))
	require.NoError(t, sqlitex.Exec(conn, "INSERT INTO spaces (id, comment_count) VALUES ('present', 5)", nil))
	require.NoError(t, updateSpaceCommentStats(conn, "present"))

	var rows []string

	require.NoError(t, sqlitex.Exec(conn, "SELECT id || ':' || comment_count FROM spaces ORDER BY id", func(stmt *sqlite.Stmt) error {
		rows = append(rows, stmt.ColumnText(0))
		return nil
	}))
	require.Equal(t, []string{"present:0"}, rows)
}
