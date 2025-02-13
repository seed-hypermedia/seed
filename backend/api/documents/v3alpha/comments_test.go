package documents

import (
	"context"
	"seed/backend/core/coretest"
	pb "seed/backend/genproto/documents/v3alpha"
	"seed/backend/testutil"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestComments_Smoke(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create the initial home document.
	homeDoc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Alice's Home Page"}}},
		},
	})
	require.NoError(t, err)

	// Create comment with Bob's key.
	cmt, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "bob",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  homeDoc.Version,
		Content: []*pb.BlockNode{
			{
				Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Hello, Alice!"},
				Children: []*pb.BlockNode{
					{Block: &pb.Block{Id: "b2", Type: "paragraph", Text: "How are you?"}},
				},
			},
		},
	})
	require.NoError(t, err, "bob must be allowed to create comments in alice's space")

	// Create a reply by Alice.
	reply, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  homeDoc.Version,
		ReplyParent:    cmt.Id,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "I'm good, thank you!"}},
		},
	})
	require.NoError(t, err)
	require.Equal(t, cmt.Id, reply.ThreadRoot, "thread root of the first reply must match")
	require.Equal(t, cmt.Id, reply.ReplyParent, "reply parent of the first reply must be the same as thread root")

	// Create further reply.
	reply2, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "bob",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  homeDoc.Version,
		ReplyParent:    reply.Id,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Glad for you!"}},
		},
	})
	require.NoError(t, err)

	require.Equal(t, cmt.Id, reply2.ThreadRoot, "second comment must take thread root of the first comment")
	require.Equal(t, reply.Id, reply2.ReplyParent, "reply parent of the second comment must be previous comment")

	want := &pb.ListCommentsResponse{
		Comments: []*pb.Comment{cmt, reply, reply2},
	}

	list, err := alice.ListComments(ctx, &pb.ListCommentsRequest{
		TargetAccount: alice.me.Account.PublicKey.String(),
		TargetPath:    "",
	})
	require.NoError(t, err)

	testutil.StructsEqual(want, list).Compare(t, "comment list must match")
}
