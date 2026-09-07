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

// qLegacyCommentAggAll is the query the listings used to run inline, on every
// request, to derive comment activity from the raw Comment blobs. It is kept here
// as the oracle for resource_comment_stats: the maintained table must agree with
// it exactly, or the listings changed meaning.
//
// Verbatim from the deleted qListDocsCommentAggScoped with the whole-database
// scope substituted, so the comparison is against what shipped, not a
// paraphrase of it.
const qLegacyCommentAggAll = `
	WITH RECURSIVE
	targets AS (
		SELECT id FROM resources tr WHERE (tr.iri GLOB 'hm://*')
	),
	redirected AS MATERIALIZED (
		SELECT
			dg.resource AS resource,
			da.value AS redirect_iri
		FROM document_generations dg
		JOIN document_attributes da ON da.resource = dg.resource AND da.kind = 's'
		JOIN document_attribute_keys dak ON dak.id = da.key AND dak.key = '$db.redirect'
		WHERE da.value IS NOT NULL
		AND dg.generation = (SELECT MAX(g.generation) FROM document_generations g WHERE g.resource = dg.resource)
	),
	chains(source, target_iri, depth) AS (
		SELECT rd.resource, rd.redirect_iri, 0 FROM redirected rd
		UNION ALL
		SELECT c.source, rd.redirect_iri, c.depth + 1
		FROM chains c
		JOIN resources tr ON tr.iri = c.target_iri
		JOIN redirected rd ON rd.resource = tr.id
		WHERE c.depth < 16 AND rd.redirect_iri != c.target_iri
	),
	credits AS (
		SELECT DISTINCT c.source, tr.id AS target
		FROM chains c
		JOIN resources tr ON tr.iri = c.target_iri
		WHERE tr.id != c.source
		AND (tr.iri GLOB 'hm://*')
	),
	sources AS (
		SELECT id FROM targets
		UNION
		SELECT source FROM credits
	),
	cand_tsids AS (
		SELECT DISTINCT sb.extra_attrs->>'tsid' AS tsid
		FROM structural_blobs sb
		WHERE sb.type = 'Comment'
		AND sb.resource IN (SELECT id FROM sources)
	),
	deduped AS (
		SELECT
			sb.resource AS resource,
			sb.id AS id,
			sb.ts AS ts,
			ROW_NUMBER() OVER (PARTITION BY sb.extra_attrs->>'tsid' ORDER BY sb.ts DESC, sb.id DESC) AS rn,
			sb.extra_attrs->>'deleted' AS deleted
		FROM cand_tsids ct
		JOIN structural_blobs sb ON sb.extra_attrs->>'tsid' = ct.tsid
		WHERE sb.type = 'Comment'
	),
	live AS (
		SELECT resource, id, ts FROM deduped WHERE rn = 1 AND deleted IS NULL
	),
	credited AS (
		SELECT l.resource AS resource, l.id, l.ts FROM live l
		WHERE l.resource IN (SELECT id FROM targets)
		UNION ALL
		SELECT cr.target, l.id, l.ts FROM live l JOIN credits cr ON cr.source = l.resource
	),
	totals AS (
		SELECT resource, COUNT(*) AS comment_count FROM credited GROUP BY resource
	),
	latest AS (
		SELECT resource, MAX(ts) AS last_comment_time, id AS last_comment FROM credited GROUP BY resource
	)
	SELECT t.resource, t.comment_count, l.last_comment_time, l.last_comment
	FROM totals t
	JOIN latest l ON l.resource = t.resource
	ORDER BY t.resource;
`

const qMaintainedCommentStats = `
	SELECT resource, comment_count, last_comment_time, last_comment
	FROM resource_comment_stats
	ORDER BY resource;
`

// TestCommentStatsMatchLegacyAggregation pins the maintained comment tables to the
// query they replaced.
//
// The listings used to derive comment activity per request, walking the redirect
// graph and de-duplicating comment versions in SQL every time. That is now settled
// at index time (backend/blob/comment_stats.go), which is only safe if the two
// agree on every case the old query handled: comments inherited across a move,
// multi-hop redirect chains, edits that supersede an earlier version, and deletions
// that remove one.
//
// The scenario below exercises all four, and the assertion is a full row-by-row
// comparison rather than a spot check on one document, so a resource the
// maintenance path forgot to recompute shows up as a difference.
func TestCommentStatsMatchLegacyAggregation(t *testing.T) {
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

	// move republishes doc at `to` and leaves a redirect at `from`, which is what
	// makes `to` inherit the comments written against `from`.
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

		_, err = alice.CreateRef(ctx, &pb.CreateRefRequest{
			Account:        space,
			Path:           from,
			SigningKeyName: "main",
			Target: &pb.RefTarget{Target: &pb.RefTarget_Redirect_{
				Redirect: &pb.RefTarget_Redirect{Account: space, Path: to},
			}},
		})
		require.NoError(t, err)
	}

	// A document that moves twice, so its comments have to travel a two-hop chain.
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
	_, err := alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
		Comment:        edited,
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	_, err = alice.DeleteComment(ctx, &pb.DeleteCommentRequest{
		Id:             deleted.Id,
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	// A document with no comments at all, which must appear in neither result.
	publish("/quiet")

	// Pin the numbers, not just the agreement: two identically broken sides would
	// satisfy the comparison below on their own.
	list, err := alice.ListDirectory(ctx, &pb.ListDirectoryRequest{Account: space, Recursive: true})
	require.NoError(t, err)

	counts := map[string]int32{}
	for _, doc := range list.Documents {
		counts[doc.Path] = doc.ActivitySummary.GetCommentCount()
	}

	// /c is where the twice-moved document now lives, so it carries all four of its
	// comments: two written at /a, one at /b, one at /c.
	require.Equal(t, int32(4), counts["/c"], "the moved document must keep the comments written against its old paths")
	// Three comments, one edited (an edit replaces a version, it doesn't add one)
	// and one deleted.
	require.Equal(t, int32(2), counts["/stable"], "an edit must not add a comment and a deletion must remove one")
	require.Equal(t, int32(0), counts["/quiet"])

	// Read on a connection that is released before the reindex below asks for the
	// writer.
	rows := func(query string) []string {
		t.Helper()
		conn, release, err := alice.db.ReadConn(ctx)
		require.NoError(t, err)
		defer release()
		return readCommentStatRows(t, conn, query)
	}

	want := rows(qLegacyCommentAggAll)

	require.NotEmpty(t, want, "scenario produced no comment activity, so the comparison would be vacuous")
	require.Equal(t, want, rows(qMaintainedCommentStats),
		"maintained comment stats diverged from the aggregation they replaced")

	// The migration that introduced these tables ships no backfill: it creates them
	// empty and schedules a reindex, on the premise that replaying the blobs refills
	// them. Check that premise here rather than discovering it on someone's daemon.
	require.NoError(t, alice.idx.Reindex(ctx))

	require.Equal(t, want, rows(qMaintainedCommentStats),
		"a reindex must rebuild comment stats, since that is how the migration fills them")
}

// readCommentStatRows returns "resource=N count=N last_time=N last_blob=N" per row,
// so a mismatch names the resource and the column instead of dumping structs.
func readCommentStatRows(t *testing.T, conn *sqlite.Conn, query string) []string {
	t.Helper()

	var out []string
	// Trim: sqlite rejects anything after the statement's ";", including the
	// newline the raw-string constants above end with.
	require.NoError(t, sqlitex.ExecTransient(conn, strings.TrimSpace(query), func(stmt *sqlite.Stmt) error {
		out = append(out, fmt.Sprintf("resource=%d count=%d last_time=%d last_blob=%d",
			stmt.ColumnInt64(0), stmt.ColumnInt64(1), stmt.ColumnInt64(2), stmt.ColumnInt64(3)))
		return nil
	}))
	return out
}
