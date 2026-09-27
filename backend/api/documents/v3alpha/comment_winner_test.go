package documents

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
	"time"

	"seed/backend/api/apitest"
	"seed/backend/blob"
	"seed/backend/core/coretest"
	pb "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func publishCommentTarget(t testing.TB, srv testServer, key, account, path string) *pb.Document {
	t.Helper()
	doc, err := srv.PublishDocumentChangeForTest(t.Context(), &apitest.DocumentChangeRequest{
		SigningKeyName: key, Account: account, Path: path,
		Changes: []*pb.DocumentChange{{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: path}}}},
	})
	require.NoError(t, err)
	return doc
}

func TestReplyCountDelegatedDelete(t *testing.T) {
	t.Parallel()
	srv := newTestDocsAPI(t, "alice")
	ctx := t.Context()
	owner := srv.me.Account.Principal()
	bob := coretest.NewTester("bob")
	require.NoError(t, srv.keys.StoreKey(ctx, "session", bob.Device))
	capability, err := blob.NewCapability(bob.Account, bob.Device.Principal(), bob.Account.Principal(), "", blob.RoleAgent, "session", time.Now().Add(-time.Hour).Round(blob.ClockPrecision))
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, capability))
	doc := publishCommentTarget(t, srv, "main", owner.String(), "/target")
	root, err := srv.CreateComment(ctx, &pb.CreateCommentRequest{SigningKeyName: "main", TargetAccount: owner.String(), TargetPath: doc.Path, TargetVersion: doc.Version, Content: []*pb.BlockNode{{Block: &pb.Block{Id: "root", Type: "paragraph", Text: "root"}}}})
	require.NoError(t, err)
	version, err := blob.Version(doc.Version).Parse()
	require.NoError(t, err)
	rootCID, err := cid.Decode(root.Version)
	require.NoError(t, err)
	// Delegated creation is signed as the account, not the session key.
	reply, err := blob.NewComment(bob.Device, "", bob.Account.Principal(), owner, doc.Path, version, rootCID, rootCID, []blob.CommentBlock{{Block: blob.Block{ID_Good: "reply", Type: "paragraph", Text: "reply"}}}, blob.VisibilityPublic, time.Now().Round(blob.ClockPrecision))
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, reply))
	id := blob.RecordID{Authority: bob.Account.Principal(), TSID: reply.TSID()}.String()
	check := func(want int64) {
		t.Helper()
		got, err := srv.GetCommentReplyCount(ctx, &pb.GetCommentReplyCountRequest{Id: root.Id})
		require.NoError(t, err)
		require.Equal(t, want, got.ReplyCount)
	}
	check(1)
	got, err := srv.GetComment(ctx, &pb.GetCommentRequest{Id: id})
	require.NoError(t, err)
	got.Content[0].Block.Text = "edited"
	_, err = srv.UpdateComment(ctx, &pb.UpdateCommentRequest{SigningKeyName: "session", Comment: got})
	require.NoError(t, err)
	check(1)
	// A live edit removing its thread links must not count historical links.
	got.ReplyParent = ""
	_, err = srv.UpdateComment(ctx, &pb.UpdateCommentRequest{SigningKeyName: "session", Comment: got})
	require.NoError(t, err)
	check(0)
	got.ReplyParent = root.Id
	_, err = srv.UpdateComment(ctx, &pb.UpdateCommentRequest{SigningKeyName: "session", Comment: got})
	require.NoError(t, err)
	check(1)
	_, err = srv.DeleteComment(ctx, &pb.DeleteCommentRequest{SigningKeyName: "session", Id: id})
	require.NoError(t, err)
	check(0)
}

func TestCommentResourceWinnerArrivalOrder(t *testing.T) {
	t.Parallel()
	for _, deleted := range []bool{false, true} {
		for _, reverse := range []bool{false, true} {
			t.Run(fmt.Sprintf("deleted=%v/reverse=%v", deleted, reverse), func(t *testing.T) {
				srv := newTestDocsAPI(t, "alice")
				ctx := t.Context()
				owner := srv.me.Account.Principal()
				doc := publishCommentTarget(t, srv, "main", owner.String(), "/target")
				version, err := blob.Version(doc.Version).Parse()
				require.NoError(t, err)
				ts := time.Now().Add(-time.Minute).Round(blob.ClockPrecision)
				first, err := blob.NewComment(srv.me.Account, "", owner, owner, doc.Path, version, cid.Undef, cid.Undef, []blob.CommentBlock{{Block: blob.Block{ID_Good: "body", Type: "paragraph", Text: "original"}}}, blob.VisibilityPublic, ts)
				require.NoError(t, err)
				var edits []blob.Encoded[*blob.Comment]
				for _, text := range []string{"edit one", "edit two"} {
					body := []blob.CommentBlock{{Block: blob.Block{ID_Good: "body", Type: "paragraph", Text: text}}}
					edit, err := blob.NewComment(srv.me.Account, first.TSID(), owner, owner, doc.Path, version, cid.Undef, cid.Undef, body, blob.VisibilityPublic, ts.Add(time.Second))
					require.NoError(t, err)
					edits = append(edits, edit)
				}
				if bytes.Compare(edits[0].CID.Hash(), edits[1].CID.Hash()) > 0 {
					edits[0], edits[1] = edits[1], edits[0]
				}
				versions := append([]blob.Encoded[*blob.Comment]{first}, edits...)
				winner := edits[1]
				if deleted {
					tombstone, err := blob.NewComment(srv.me.Account, first.TSID(), owner, owner, doc.Path, version, cid.Undef, cid.Undef, nil, blob.VisibilityPublic, ts.Add(2*time.Second))
					require.NoError(t, err)
					versions = append(versions, tombstone)
					winner = tombstone
				}
				for i := range versions {
					j := i
					if reverse {
						j = len(versions) - 1 - i
					}
					require.NoError(t, srv.idx.Put(ctx, versions[j]))
				}
				id := blob.RecordID{Authority: owner, TSID: first.TSID()}.String()
				current, err := srv.GetComment(ctx, &pb.GetCommentRequest{Id: id})
				resource, resourceErr := srv.GetResource(ctx, &pb.GetResourceRequest{Iri: "hm://" + id})
				if deleted {
					require.Equal(t, codes.NotFound, status.Code(err))
					require.Equal(t, codes.NotFound, status.Code(resourceErr))
					return
				}
				require.NoError(t, err)
				require.NoError(t, resourceErr)
				require.Equal(t, winner.CID.String(), current.Version)
				require.Equal(t, current.Version, resource.GetComment().Version)
			})
		}
	}
}

func TestCommentWinnerGenesisArrivalOrder(t *testing.T) {
	t.Parallel()
	for _, deleted := range []bool{false, true} {
		for _, reverse := range []bool{false, true} {
			t.Run(fmt.Sprintf("deleted=%v/reverse=%v", deleted, reverse), func(t *testing.T) {
				srv := newTestDocsAPI(t, "alice")
				ctx := t.Context()
				owner := srv.me.Account.Principal()
				bob := coretest.NewTester("bob")
				require.NoError(t, srv.keys.StoreKey(ctx, "bob", bob.Account))
				a := publishCommentTarget(t, srv, "main", owner.String(), "/a")
				b := publishCommentTarget(t, srv, "bob", bob.Account.Principal().String(), "/b")
				av, err := blob.Version(a.Version).Parse()
				require.NoError(t, err)
				bv, err := blob.Version(b.Version).Parse()
				require.NoError(t, err)
				ts := time.Now().Add(-time.Minute).Round(blob.ClockPrecision)
				body := []blob.CommentBlock{{Block: blob.Block{ID_Good: "body", Type: "paragraph", Text: "comment"}}}
				first, err := blob.NewComment(srv.me.Account, "", owner, owner, a.Path, av, cid.Undef, cid.Undef, body, blob.VisibilityPublic, ts)
				require.NoError(t, err)
				second, err := blob.NewComment(srv.me.Account, first.TSID(), owner, bob.Account.Principal(), b.Path, bv, cid.Undef, cid.Undef, body, blob.VisibilityPublic, ts.Add(time.Second))
				require.NoError(t, err)
				versions := []blob.Encoded[*blob.Comment]{first, second}
				if deleted {
					// Delete using a third target (the original document) to exercise removal
					// of the previous winner's attribution, not just the incoming target.
					tombstone, err := blob.NewComment(srv.me.Account, first.TSID(), owner, owner, a.Path, av, cid.Undef, cid.Undef, nil, blob.VisibilityPublic, ts.Add(2*time.Second))
					require.NoError(t, err)
					versions = append(versions, tombstone)
				}
				for i := range versions {
					j := i
					if reverse {
						j = len(versions) - 1 - i
					}
					require.NoError(t, srv.idx.Put(ctx, versions[j]))
				}
				check := func() {
					want := int64(1)
					if deleted {
						want = 0
					}
					require.NoError(t, srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
						rows := 0
						require.NoError(t, sqlitex.Exec(conn, "SELECT genesis, count(*) FROM comment_live GROUP BY genesis", func(s *sqlite.Stmt) error {
							rows++
							assert.Equal(t, b.Genesis, s.ColumnText(0))
							assert.Equal(t, want, s.ColumnInt64(1))
							return nil
						}))
						require.EqualValues(t, want, rows)
						require.NoError(t, sqlitex.Exec(conn, "SELECT genesis, comment_count FROM document_comment_stats", func(s *sqlite.Stmt) error {
							assert.Equal(t, b.Genesis, s.ColumnText(0))
							assert.Equal(t, want, s.ColumnInt64(1))
							return nil
						}))
						return nil
					}))
					for _, target := range []struct {
						space string
						path  string
						count int32
					}{{owner.String(), a.Path, 0}, {bob.Account.Principal().String(), b.Path, int32(want)}} {
						list, err := srv.ListDirectory(ctx, &pb.ListDirectoryRequest{Account: target.space, Recursive: true})
						require.NoError(t, err)
						found := false
						for _, doc := range list.Documents {
							if doc.Path == target.path {
								found = true
								require.Equal(t, target.count, doc.ActivitySummary.GetCommentCount())
							}
						}
						require.True(t, found, "target document must be listed")
						require.NoError(t, srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
							return sqlitex.Exec(conn, "SELECT comment_count FROM spaces WHERE id = ?", func(s *sqlite.Stmt) error { assert.EqualValues(t, target.count, s.ColumnInt64(0)); return nil }, target.space)
						}))
					}
				}
				check()
				require.NoError(t, srv.idx.Reindex(ctx))
				check()
			})
		}
	}
}

// A reply can be indexed before its document. Reply counts must not depend on
// comment_live, whose rows require resolved document attribution.
func TestReplyCountWithoutDocumentGenesis(t *testing.T) {
	t.Parallel()
	srv := newTestDocsAPI(t, "alice")
	ctx := t.Context()
	owner := srv.me.Account.Principal()
	now := time.Now().Add(-time.Minute).Round(blob.ClockPrecision)
	body := []blob.CommentBlock{{Block: blob.Block{ID_Good: "body", Type: "paragraph", Text: "comment"}}}
	root, err := blob.NewComment(srv.me.Account, "", owner, owner, "/missing", nil, cid.Undef, cid.Undef, body, blob.VisibilityPublic, now)
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, root))
	reply, err := blob.NewComment(srv.me.Account, "", owner, owner, "/missing", nil, root.CID, root.CID, body, blob.VisibilityPublic, now.Add(time.Second))
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, reply))
	id := blob.RecordID{Authority: owner, TSID: root.TSID()}.String()
	count, err := srv.GetCommentReplyCount(ctx, &pb.GetCommentReplyCountRequest{Id: id})
	require.NoError(t, err)
	require.EqualValues(t, 1, count.ReplyCount)
	tombstone, err := blob.NewComment(srv.me.Account, reply.TSID(), owner, owner, "/missing", nil, cid.Undef, cid.Undef, nil, blob.VisibilityPublic, now.Add(2*time.Second))
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, tombstone))
	count, err = srv.GetCommentReplyCount(ctx, &pb.GetCommentReplyCountRequest{Id: id})
	require.NoError(t, err)
	require.Zero(t, count.ReplyCount)
}

func TestCommentWinnerQueriesSeek(t *testing.T) {
	t.Parallel()
	srv := newTestDocsAPI(t, "alice")
	conn, release, err := srv.db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()
	for _, q := range []string{qGetResource(), qGetReplyCountByID()} {
		var plan strings.Builder
		require.NoError(t, sqlitex.ExecTransient(conn, "EXPLAIN QUERY PLAN "+q, func(stmt *sqlite.Stmt) error {
			plan.WriteString(stmt.ColumnText(3))
			plan.WriteByte('\n')
			return nil
		}, srv.me.Account.Principal(), ""))
		require.Contains(t, plan.String(), "structural_blobs_by_tsid")
		require.NotContains(t, plan.String(), "SCAN structural_blobs")
		require.NotContains(t, plan.String(), "SCAN sb")
		require.NotContains(t, plan.String(), "SCAN latest")
		t.Log(plan.String())
	}
}
