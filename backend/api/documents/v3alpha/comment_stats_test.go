package documents

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"seed/backend/api/apitest"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	pb "seed/backend/genproto/documents/v3alpha"

	"github.com/stretchr/testify/require"
)

// qDocumentCommentStats is what the listings read.
const qDocumentCommentStats = `
	SELECT genesis, comment_count, last_comment_time, COALESCE(last_comment, 0)
	FROM document_comment_stats ORDER BY genesis;
`

// qDocumentLiveCommentCount is what it should be: comment_live aggregated by the
// document each comment belongs to. Zero-count rows are excluded because
// updateDocumentCommentStats prunes them.
const qDocumentLiveCommentCount = `
	SELECT genesis, COUNT(*), MAX(ts),
	       (SELECT l2.blob_id FROM comment_live l2 WHERE l2.genesis = l.genesis
	         ORDER BY l2.ts DESC, l2.blob_id DESC LIMIT 1)
	FROM comment_live l GROUP BY genesis ORDER BY genesis;
`

const qSpaceCommentStats = `
	SELECT id, comment_count, last_comment_time, COALESCE(last_comment, 0)
	FROM spaces ORDER BY id;
`

const qSpaceLiveCommentCount = `
	SELECT s.id,
	       (SELECT COUNT(*) FROM comment_live l JOIN resources r ON r.id = l.resource
	         WHERE r.iri = 'hm://' || s.id
	         OR (r.iri >= 'hm://' || s.id || '/' AND r.iri < 'hm://' || s.id || '0')),
	       COALESCE((SELECT MAX(l.ts) FROM comment_live l JOIN resources r ON r.id = l.resource
	         WHERE r.iri = 'hm://' || s.id
	         OR (r.iri >= 'hm://' || s.id || '/' AND r.iri < 'hm://' || s.id || '0')), 0),
	       COALESCE((SELECT l.blob_id FROM comment_live l JOIN resources r ON r.id = l.resource
	         WHERE r.iri = 'hm://' || s.id
	         OR (r.iri >= 'hm://' || s.id || '/' AND r.iri < 'hm://' || s.id || '0')
	         ORDER BY l.ts DESC, l.blob_id DESC LIMIT 1), 0)
	FROM spaces s ORDER BY s.id;
`

// TestCommentActivityFollowsTheDocument pins what a comment count means.
//
// A comment belongs to a document, and a document is its genesis. Two consequences
// have to hold at once, and they used to be in tension because the old rule keyed
// on the redirect graph instead:
//
//   - a document that moves keeps its comments, at every path in the chain, because
//     moving republishes the same genesis;
//   - a redirect between two *unrelated* documents transfers nothing, because their
//     genesises differ.
//
// The second one is the change. On a 6.2 GB production database the old rule was
// crediting 293 comments written against /tech-talks onto /tech, which is a
// different document that /tech-talks merely redirects to.
func TestCommentActivityFollowsTheDocument(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()
	space := alice.me.Account.PublicKey.String()

	publish := func(path string) *pb.Document {
		t.Helper()
		doc, err := alice.PublishDocumentChangeForTest(ctx, &apitest.DocumentChangeRequest{
			SigningKeyName: "main",
			Account:        space,
			Path:           path,
			Changes: []*pb.DocumentChange{
				{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "doc " + path}}},
			},
		})
		require.NoError(t, err)
		return doc
	}

	comment := func(doc *pb.Document, path, text string) *pb.Comment {
		t.Helper()
		cmt, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
			SigningKeyName: "main",
			TargetAccount:  space,
			TargetPath:     path,
			TargetVersion:  doc.Version,
			Content:        []*pb.BlockNode{{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: text}}},
		})
		require.NoError(t, err)
		return cmt
	}

	// redirect points `from` at `to` without republishing anything, which is how a
	// redirect to an unrelated document looks.
	redirect := func(from, to string) {
		t.Helper()
		_, err := alice.CreateRef(ctx, &pb.CreateRefRequest{
			Account:        space,
			Path:           from,
			SigningKeyName: "main",
			Target: &pb.RefTarget{Target: &pb.RefTarget_Redirect_{
				Redirect: &pb.RefTarget_Redirect{Account: space, Path: to},
			}},
		})
		require.NoError(t, err)
	}

	// move republishes the same document at `to` first, so both paths carry the
	// same genesis, and then redirects the old path at it.
	move := func(doc *pb.Document, from, to string) {
		t.Helper()
		_, err := alice.CreateRef(ctx, &pb.CreateRefRequest{
			Account:        space,
			Path:           to,
			SigningKeyName: "main",
			Target: &pb.RefTarget{Target: &pb.RefTarget_Version_{
				Version: &pb.RefTarget_Version{Genesis: doc.Genesis, Version: doc.Version},
			}},
		})
		require.NoError(t, err)
		redirect(from, to)
	}

	// A document that moves twice. Its comments must survive both hops.
	moved := publish("/a")
	comment(moved, "/a", "written at /a")
	comment(moved, "/a", "also at /a")
	move(moved, "/a", "/b")
	comment(moved, "/b", "written at /b")
	move(moved, "/b", "/c")
	comment(moved, "/c", "written at /c")

	// A document that stays put, with an edited and a deleted comment.
	stable := publish("/stable")
	edited := comment(stable, "/stable", "first version")
	deleted := comment(stable, "/stable", "will be deleted")
	comment(stable, "/stable", "untouched")

	edited.Content = []*pb.BlockNode{{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "second version"}}}
	_, err := alice.UpdateComment(ctx, &pb.UpdateCommentRequest{Comment: edited, SigningKeyName: "main"})
	require.NoError(t, err)

	_, err = alice.DeleteComment(ctx, &pb.DeleteCommentRequest{Id: deleted.Id, SigningKeyName: "main"})
	require.NoError(t, err)

	// The case this change is about: /orphan has a comment and redirects at
	// /unrelated, which is a different document. /unrelated must not inherit it.
	orphan := publish("/orphan")
	comment(orphan, "/orphan", "belongs to /orphan only")
	publish("/unrelated")
	redirect("/orphan", "/unrelated")

	publish("/quiet")

	counts := func() map[string]int32 {
		t.Helper()
		list, err := alice.ListDirectory(ctx, &pb.ListDirectoryRequest{Account: space, Recursive: true})
		require.NoError(t, err)
		out := map[string]int32{}
		for _, doc := range list.Documents {
			out[doc.Path] = doc.ActivitySummary.GetCommentCount()
		}
		return out
	}

	got := counts()
	// Four comments: two written at /a, one at /b, one at /c. Same document
	// throughout, so they all land on the path it lives at now.
	require.Equal(t, int32(4), got["/c"], "a moved document must keep the comments written against its old paths")
	// Three comments, one edited (an edit replaces a version, it does not add one)
	// and one deleted.
	require.Equal(t, int32(2), got["/stable"], "an edit must not add a comment and a deletion must remove one")
	// The whole point: a redirect is not a move, and these are different documents.
	require.Equal(t, int32(0), got["/unrelated"], "a redirect to an unrelated document must not transfer its comments")
	require.Equal(t, int32(0), got["/quiet"])

	rows := func(query string) []string {
		t.Helper()
		conn, release, err := alice.db.ReadConn(ctx)
		require.NoError(t, err)
		defer release()
		return readStatRows(t, conn, query)
	}

	// ListComments has to agree with the counts, or the two disagree about what a
	// document's comments are -- which is the complaint in #779.
	listed, err := alice.ListComments(ctx, &pb.ListCommentsRequest{TargetAccount: space, TargetPath: "/c", PageSize: 100})
	require.NoError(t, err)
	require.Len(t, listed.Comments, 4, "ListComments must return what the count reports")

	orphaned, err := alice.ListComments(ctx, &pb.ListCommentsRequest{TargetAccount: space, TargetPath: "/unrelated", PageSize: 100})
	require.NoError(t, err)
	require.Empty(t, orphaned.Comments, "ListComments must not show another document's comments either")

	// Querying by a path the document moved away from still works, because that
	// path's own latest generation carries the same genesis. Notification links
	// record the historical path, so they depend on this.
	byOldPath, err := alice.ListComments(ctx, &pb.ListCommentsRequest{TargetAccount: space, TargetPath: "/a", PageSize: 100})
	require.NoError(t, err)
	require.Len(t, byOldPath.Comments, 4, "a moved document's comments must stay reachable by its old path")

	assertConsistent := func(when string) {
		t.Helper()

		require.Equal(t, rows(qDocumentLiveCommentCount), rows(qDocumentCommentStats),
			"stored document stats diverged from comment_live %s", when)
		require.Equal(t, rows(qSpaceLiveCommentCount), rows(qSpaceCommentStats),
			"stored space stats diverged from comment_live %s", when)

		// Space totals count each live comment once, by location: four on the moved
		// document, two surviving on /stable, one on /orphan.
		acc, err := alice.GetAccount(ctx, &pb.GetAccountRequest{Id: space})
		require.NoError(t, err)
		require.Equal(t, int32(7), acc.ActivitySummary.GetCommentCount(), "space comment total is wrong %s", when)
	}

	assertConsistent("after incremental indexing")

	// The migration that introduced these tables ships no backfill: it creates them
	// empty and schedules a reindex, on the premise that replaying the blobs refills
	// them. Check that premise here rather than discovering it on someone's daemon.
	require.NoError(t, alice.idx.Reindex(ctx))

	require.Equal(t, got, counts(), "a reindex must reproduce the same counts")
	assertConsistent("after a reindex")
}

// readStatRows formats a four-column stats row as text, so a mismatch names the
// key and the column instead of dumping structs.
func readStatRows(t *testing.T, conn *sqlite.Conn, query string) []string {
	t.Helper()

	var out []string
	require.NoError(t, sqlitex.ExecTransient(conn, strings.TrimSpace(query), func(stmt *sqlite.Stmt) error {
		out = append(out, fmt.Sprintf("key=%s count=%d last_time=%d last_blob=%d",
			stmt.ColumnText(0), stmt.ColumnInt64(1), stmt.ColumnInt64(2), stmt.ColumnInt64(3)))
		return nil
	}))
	return out
}
