package documents

import (
	"testing"
	"time"

	"seed/backend/api/apitest"
	"seed/backend/blob"
	pb "seed/backend/genproto/documents/v3alpha"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
)

// TestCommentListedWhenSyncedBeforeItsTargetChange guards #1200: comments stored
// before their target document must become listed and counted when it arrives.
func TestCommentListedWhenSyncedBeforeItsTargetChange(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	alice := newTestDocsAPI(t, "alice")
	space := alice.me.Account.PublicKey.String()
	const path = "/notes/doc"

	doc, err := alice.PublishDocumentChangeForTest(ctx, &apitest.DocumentChangeRequest{
		SigningKeyName: "main",
		Account:        space,
		Path:           path,
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "doc"}}},
		},
	})
	require.NoError(t, err)

	comment := func(text, replyParent string) *pb.Comment {
		t.Helper()
		cmt, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
			SigningKeyName: "main",
			TargetAccount:  space,
			TargetPath:     path,
			TargetVersion:  doc.Version,
			ReplyParent:    replyParent,
			Content:        []*pb.BlockNode{{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: text}}},
		})
		require.NoError(t, err)
		return cmt
	}
	root := comment("root", "")
	reply := comment("reply", root.Id)

	// A comment that pins no version means "the document at this path".
	unpinned, err := blob.NewComment(alice.me.Account, "", alice.me.Account.Principal(), path, nil, cid.Undef, cid.Undef,
		[]blob.CommentBlock{{Block: blob.Block{ID_Good: "b1", Type: "paragraph", Text: "unpinned"}}}, blob.VisibilityPublic,
		time.Now().Round(blob.ClockPrecision))
	require.NoError(t, err)
	require.NoError(t, alice.idx.Put(ctx, unpinned))
	unpinnedID := alice.me.Account.Principal().String() + "/" + unpinned.TSID().String()

	// Everything alice has, keyed by CID, so each scenario can pick an order.
	all := map[cid.Cid]blocks.Block{}
	keys, err := alice.idx.AllKeysChan(ctx)
	require.NoError(t, err)
	for c := range keys {
		blk, err := alice.idx.Get(ctx, c)
		require.NoError(t, err)
		all[c] = blk
	}
	rootCID := cid.MustParse(root.Version)
	replyCID := cid.MustParse(reply.Version)
	unpinnedCID := unpinned.CID

	rest := func(exclude ...cid.Cid) []blocks.Block {
		out := make([]blocks.Block, 0, len(all))
	next:
		for c, blk := range all {
			for _, e := range exclude {
				if c.Equals(e) {
					continue next
				}
			}
			out = append(out, blk)
		}
		return out
	}

	want := []string{root.Id, reply.Id, unpinnedID}

	check := func(t *testing.T, bob testServer) {
		t.Helper()

		res, err := bob.ListComments(ctx, &pb.ListCommentsRequest{TargetAccount: space, TargetPath: path, PageSize: 100})
		require.NoError(t, err)
		got := make([]string, 0, len(res.Comments))
		for _, c := range res.Comments {
			got = append(got, c.Id)
		}
		require.ElementsMatch(t, want, got, "ListComments")

		list, err := bob.ListDirectory(ctx, &pb.ListDirectoryRequest{Account: space, Recursive: true})
		require.NoError(t, err)
		for _, d := range list.Documents {
			if d.Path == path {
				require.EqualValues(t, len(want), d.ActivitySummary.GetCommentCount(), "comment count")
				return
			}
		}
		t.Fatalf("document %s not listed", path)
	}

	t.Run("document first (control)", func(t *testing.T) {
		t.Parallel()
		bob := newTestDocsAPI(t, "bob")
		require.NoError(t, bob.idx.PutMany(ctx, rest(rootCID, replyCID, unpinnedCID)))
		require.NoError(t, bob.idx.Put(ctx, all[rootCID]))
		require.NoError(t, bob.idx.Put(ctx, all[replyCID]))
		require.NoError(t, bob.idx.Put(ctx, all[unpinnedCID]))
		check(t, bob)
	})

	t.Run("comments arrive alone before the document", func(t *testing.T) {
		t.Parallel()
		bob := newTestDocsAPI(t, "bob")
		require.NoError(t, bob.idx.Put(ctx, all[rootCID]))
		require.NoError(t, bob.idx.Put(ctx, all[unpinnedCID]))
		require.NoError(t, bob.idx.PutMany(ctx, rest(rootCID, unpinnedCID)))
		check(t, bob)
	})

	t.Run("comments first within one batch", func(t *testing.T) {
		t.Parallel()
		bob := newTestDocsAPI(t, "bob")
		batch := append([]blocks.Block{all[rootCID], all[unpinnedCID]}, rest(rootCID, unpinnedCID)...)
		require.NoError(t, bob.idx.PutMany(ctx, batch))
		check(t, bob)
	})

	t.Run("reply then root then the document", func(t *testing.T) {
		t.Parallel()
		bob := newTestDocsAPI(t, "bob")
		require.NoError(t, bob.idx.Put(ctx, all[replyCID]))
		require.NoError(t, bob.idx.Put(ctx, all[rootCID]))
		require.NoError(t, bob.idx.PutMany(ctx, rest(rootCID, replyCID)))
		check(t, bob)
	})
}
