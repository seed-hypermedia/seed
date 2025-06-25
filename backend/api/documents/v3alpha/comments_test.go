package documents

import (
	"context"
	"fmt"
	"seed/backend/core/coretest"
	pb "seed/backend/genproto/documents/v3alpha"
	"seed/backend/testutil"
	"seed/backend/util/debugx"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

	{
		cmt, err := alice.GetComment(ctx, &pb.GetCommentRequest{
			Id: cmt.Id,
		})
		require.NoError(t, err)
		debugx.Dump(cmt)
	}

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

func TestListCommentsByAuthor(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()

	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create the initial document.
	doc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"}}},
		},
	})
	require.NoError(t, err)

	// Create comments by different authors.
	bobComment1, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "bob",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Bob's first comment"}},
		},
	})
	require.NoError(t, err)

	aliceComment1, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "a1", Type: "paragraph", Text: "Alice's first comment"}},
		},
	})
	require.NoError(t, err)

	bobComment2, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "bob",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b2", Type: "paragraph", Text: "Bob's second comment"}},
		},
	})
	require.NoError(t, err)

	// Test listing Bob's comments.
	bobComments, err := alice.ListCommentsByAuthor(ctx, &pb.ListCommentsByAuthorRequest{
		Author: bob.Account.PublicKey.String(),
	})
	require.NoError(t, err)
	require.Len(t, bobComments.Comments, 2, "Bob should have 2 comments")

	// Comments should be ordered by creation time (newest first due to DESC ordering).
	require.Equal(t, bobComment2.Id, bobComments.Comments[0].Id, "Bob's second comment should be first")
	require.Equal(t, bobComment1.Id, bobComments.Comments[1].Id, "Bob's first comment should be second")

	// Test listing Alice's comments.
	aliceComments, err := alice.ListCommentsByAuthor(ctx, &pb.ListCommentsByAuthorRequest{
		Author: alice.me.Account.PublicKey.String(),
	})
	require.NoError(t, err)
	require.Len(t, aliceComments.Comments, 1, "Alice should have 1 comment")
	require.Equal(t, aliceComment1.Id, aliceComments.Comments[0].Id, "Alice's comment should match")

	// Test listing comments for non-existent author (create a fake principal).
	fakeAuthor := "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
	emptyComments, err := alice.ListCommentsByAuthor(ctx, &pb.ListCommentsByAuthorRequest{
		Author: fakeAuthor,
	})
	require.NoError(t, err)
	require.Len(t, emptyComments.Comments, 0, "Non-existent author should have 0 comments")
}

func TestListCommentsByAuthor_Pagination(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()

	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create the initial document.
	doc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"}}},
		},
	})
	require.NoError(t, err)

	// Create multiple comments by Bob to test pagination.
	var comments []*pb.Comment
	for i := 0; i < 5; i++ {
		comment, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
			SigningKeyName: "bob",
			TargetAccount:  alice.me.Account.PublicKey.String(),
			TargetPath:     "",
			TargetVersion:  doc.Version,
			Content: []*pb.BlockNode{
				{Block: &pb.Block{Id: fmt.Sprintf("b%d", i), Type: "paragraph", Text: fmt.Sprintf("Bob's comment %d", i)}},
			},
		})
		require.NoError(t, err)
		comments = append(comments, comment)
	}

	// Test pagination with page size 2.
	page1, err := alice.ListCommentsByAuthor(ctx, &pb.ListCommentsByAuthorRequest{
		Author:   bob.Account.PublicKey.String(),
		PageSize: 2,
	})
	require.NoError(t, err)
	require.Len(t, page1.Comments, 2, "First page should have 2 comments")
	require.NotEmpty(t, page1.NextPageToken, "First page should have next page token")

	// Comments should be ordered newest first.
	require.Equal(t, comments[4].Id, page1.Comments[0].Id, "Newest comment should be first")
	require.Equal(t, comments[3].Id, page1.Comments[1].Id, "Second newest comment should be second")

	// Test second page.
	page2, err := alice.ListCommentsByAuthor(ctx, &pb.ListCommentsByAuthorRequest{
		Author:    bob.Account.PublicKey.String(),
		PageSize:  2,
		PageToken: page1.NextPageToken,
	})
	require.NoError(t, err)
	require.Len(t, page2.Comments, 2, "Second page should have 2 comments")
	require.NotEmpty(t, page2.NextPageToken, "Second page should have next page token")
	require.Equal(t, comments[2].Id, page2.Comments[0].Id, "Third newest comment should be first on page 2")
	require.Equal(t, comments[1].Id, page2.Comments[1].Id, "Fourth newest comment should be second on page 2")

	// Test third page.
	page3, err := alice.ListCommentsByAuthor(ctx, &pb.ListCommentsByAuthorRequest{
		Author:    bob.Account.PublicKey.String(),
		PageSize:  2,
		PageToken: page2.NextPageToken,
	})
	require.NoError(t, err)
	require.Len(t, page3.Comments, 1, "Third page should have 1 comment")
	require.Empty(t, page3.NextPageToken, "Third page should not have next page token")
	require.Equal(t, comments[0].Id, page3.Comments[0].Id, "Oldest comment should be on last page")

	// Test invalid page token.
	_, err = alice.ListCommentsByAuthor(ctx, &pb.ListCommentsByAuthorRequest{
		Author:    bob.Account.PublicKey.String(),
		PageToken: "invalid-token",
	})
	require.Error(t, err, "Invalid page token should return error")
}

func TestListCommentsByAuthor_InvalidAuthor(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Test with invalid author principal.
	_, err := alice.ListCommentsByAuthor(ctx, &pb.ListCommentsByAuthorRequest{
		Author: "invalid-principal",
	})
	require.Error(t, err, "Invalid author principal should return error")
	require.Contains(t, err.Error(), "failed to parse author", "Error should mention author parsing")
}

func TestGetComment(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create the initial document.
	doc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"}}},
		},
	})
	require.NoError(t, err)

	// Create a comment.
	comment, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test comment"}},
		},
	})
	require.NoError(t, err)

	// Get the comment.
	retrieved, err := alice.GetComment(ctx, &pb.GetCommentRequest{
		Id: comment.Id,
	})
	require.NoError(t, err)
	require.Equal(t, comment.Id, retrieved.Id)
	require.Equal(t, comment.Content[0].Block.Text, retrieved.Content[0].Block.Text)

	// Getting comment with a CID should work too.
	{
		retrieved, err := alice.GetComment(ctx, &pb.GetCommentRequest{
			Id: comment.Version,
		})
		require.NoError(t, err)
		require.Equal(t, comment.Id, retrieved.Id)
		require.Equal(t, comment.Content[0].Block.Text, retrieved.Content[0].Block.Text)
	}

	// Test with invalid comment ID.
	_, err = alice.GetComment(ctx, &pb.GetCommentRequest{
		Id: "invalid-id",
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to parse comment ID")

	// Test with non-existent comment ID.
	fakeID := "hm://z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK/2024-01-01T00:00:00.000Z"
	_, err = alice.GetComment(ctx, &pb.GetCommentRequest{
		Id: fakeID,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "InvalidArgument")
}

func TestBatchGetComments(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create the initial document.
	doc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"}}},
		},
	})
	require.NoError(t, err)

	// Create multiple comments.
	comment1, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "First comment"}},
		},
	})
	require.NoError(t, err)

	comment2, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b2", Type: "paragraph", Text: "Second comment"}},
		},
	})
	require.NoError(t, err)

	// Batch get comments.
	batch, err := alice.BatchGetComments(ctx, &pb.BatchGetCommentsRequest{
		Ids: []string{comment1.Id, comment2.Id},
	})
	require.NoError(t, err)
	require.Len(t, batch.Comments, 2)
	require.Equal(t, comment1.Id, batch.Comments[0].Id)
	require.Equal(t, comment2.Id, batch.Comments[1].Id)

	// Test with invalid comment ID in batch.
	_, err = alice.BatchGetComments(ctx, &pb.BatchGetCommentsRequest{
		Ids: []string{comment1.Id, "invalid-id"},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to parse comment ID")

	// Test with empty batch.
	emptyBatch, err := alice.BatchGetComments(ctx, &pb.BatchGetCommentsRequest{
		Ids: []string{},
	})
	require.NoError(t, err)
	require.Len(t, emptyBatch.Comments, 0)
}

func TestCreateComment_ErrorHandling(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create the initial document.
	doc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"}}},
		},
	})
	require.NoError(t, err)

	// Test missing signing key.
	_, err = alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test"}},
		},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "signing_key")

	// Test missing target version.
	_, err = alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  "",
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test"}},
		},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "target_version")

	// Test invalid target account.
	_, err = alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  "invalid-account",
		TargetPath:     "",
		TargetVersion:  doc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test"}},
		},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to parse target account")

	// Test invalid target version.
	_, err = alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  "invalid-version",
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test"}},
		},
	})
	require.Error(t, err)

	// Test invalid reply parent.
	_, err = alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		ReplyParent:    "invalid-parent-id",
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test"}},
		},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to parse comment ID")

	// Test non-existent reply parent.
	fakeParentID := "hm://z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK/2024-01-01T00:00:00.000Z"
	_, err = alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "main",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  doc.Version,
		ReplyParent:    fakeParentID,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test"}},
		},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "reply parent")
	require.Contains(t, err.Error(), "InvalidArgument")
}

func TestListComments_ErrorHandling(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Test invalid target account.
	_, err := alice.ListComments(ctx, &pb.ListCommentsRequest{
		TargetAccount: "invalid-account",
		TargetPath:    "",
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to parse target account")

	// Test invalid target path.
	_, err = alice.ListComments(ctx, &pb.ListCommentsRequest{
		TargetAccount: alice.me.Account.PublicKey.String(),
		TargetPath:    "invalid\x00path",
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to parse target path")

	// Test empty results for valid but non-existent resource.
	result, err := alice.ListComments(ctx, &pb.ListCommentsRequest{
		TargetAccount: alice.me.Account.PublicKey.String(),
		TargetPath:    "/non-existent-document",
	})
	require.NoError(t, err)
	require.Len(t, result.Comments, 0)
}

func TestUpdateComment(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create home document
	homeDoc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"}}},
		},
	})
	require.NoError(t, err)

	// Create initial comment
	originalComment, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "bob",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  homeDoc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Original comment"}},
		},
	})
	require.NoError(t, err)

	t.Run("successfully update comment", func(t *testing.T) {
		// Update the comment
		updatedComment, err := alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
			Comment: &pb.Comment{
				Id:            originalComment.Id,
				TargetAccount: alice.me.Account.PublicKey.String(),
				TargetPath:    "",
				TargetVersion: homeDoc.Version,
				Author:        bob.Account.PublicKey.String(),
				Content: []*pb.BlockNode{
					{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Updated comment content"}},
				},
			},
			SigningKeyName: "bob",
		})
		require.NoError(t, err)

		// Verify the comment was updated
		require.Equal(t, originalComment.Id, updatedComment.Id)
		require.Equal(t, "Updated comment content", updatedComment.Content[0].Block.Text)
		require.True(t, updatedComment.UpdateTime.AsTime().After(updatedComment.CreateTime.AsTime()))

		// Verify we can retrieve the updated comment
		retrieved, err := alice.GetComment(ctx, &pb.GetCommentRequest{Id: originalComment.Id})
		require.NoError(t, err)
		require.Equal(t, "Updated comment content", retrieved.Content[0].Block.Text)
	})

	t.Run("missing required fields", func(t *testing.T) {
		// Missing comment
		_, err := alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
			SigningKeyName: "bob",
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "comment is required")

		// Missing signing key name
		_, err = alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
			Comment: &pb.Comment{
				Id:            originalComment.Id,
				TargetAccount: alice.me.Account.PublicKey.String(),
				TargetPath:    "",
				TargetVersion: homeDoc.Version,
				Content: []*pb.BlockNode{
					{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test"}},
				},
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "signing_key_name is required")

		// Missing comment content
		_, err = alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
			Comment: &pb.Comment{
				Id:            originalComment.Id,
				TargetAccount: alice.me.Account.PublicKey.String(),
				TargetPath:    "",
				TargetVersion: homeDoc.Version,
				Content:       []*pb.BlockNode{},
			},
			SigningKeyName: "bob",
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "comment.content is required")
	})

	t.Run("permission denied - wrong author", func(t *testing.T) {
		_, err := alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
			Comment: &pb.Comment{
				Id:            originalComment.Id,
				TargetAccount: alice.me.Account.PublicKey.String(),
				TargetPath:    "",
				TargetVersion: homeDoc.Version,
				Content: []*pb.BlockNode{
					{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Unauthorized update"}},
				},
			},
			SigningKeyName: "main", // Alice trying to update Bob's comment
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "only the original author can update")
	})

	t.Run("invalid comment ID", func(t *testing.T) {
		_, err := alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
			Comment: &pb.Comment{
				Id:            "invalid-comment-id",
				TargetAccount: alice.me.Account.PublicKey.String(),
				TargetPath:    "",
				TargetVersion: homeDoc.Version,
				Content: []*pb.BlockNode{
					{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Test"}},
				},
			},
			SigningKeyName: "bob",
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "failed to decode comment ID")
	})
}

func TestDeleteComment(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create home document
	homeDoc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"}}},
		},
	})
	require.NoError(t, err)

	// Create comment to delete
	comment, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "bob",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  homeDoc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Comment to be deleted"}},
		},
	})
	require.NoError(t, err)

	t.Run("successfully delete comment", func(t *testing.T) {
		// Get original comment version for comparison
		originalComment, err := alice.GetComment(ctx, &pb.GetCommentRequest{Id: comment.Id})
		require.NoError(t, err)
		t.Logf("Original comment version: %s", originalComment.Version)

		// Delete the comment
		_, err = alice.DeleteComment(ctx, &pb.DeleteCommentRequest{
			Id:             comment.Id,
			SigningKeyName: "bob",
		})
		require.NoError(t, err)
		t.Logf("Delete operation completed")

		// Verify the comment is no longer retrievable
		_, err = alice.GetComment(ctx, &pb.GetCommentRequest{Id: comment.Id})
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok, "error must be a gRPC status error")
		require.Equal(t, codes.NotFound, st.Code())
	})

	t.Run("missing required fields", func(t *testing.T) {
		// Missing ID
		_, err := alice.DeleteComment(ctx, &pb.DeleteCommentRequest{
			SigningKeyName: "bob",
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "id is required")

		// Missing signing key name
		_, err = alice.DeleteComment(ctx, &pb.DeleteCommentRequest{
			Id: comment.Id,
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "signing_key_name is required")
	})

	t.Run("permission denied - wrong author", func(t *testing.T) {
		// Create another comment for this test
		anotherComment, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
			SigningKeyName: "bob",
			TargetAccount:  alice.me.Account.PublicKey.String(),
			TargetPath:     "",
			TargetVersion:  homeDoc.Version,
			Content: []*pb.BlockNode{
				{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Another comment"}},
			},
		})
		require.NoError(t, err)

		// Try to delete with wrong key
		_, err = alice.DeleteComment(ctx, &pb.DeleteCommentRequest{
			Id:             anotherComment.Id,
			SigningKeyName: "main", // Alice trying to delete Bob's comment
		})
		require.Error(t, err)
	})

	t.Run("invalid comment ID", func(t *testing.T) {
		_, err := alice.DeleteComment(ctx, &pb.DeleteCommentRequest{
			Id:             "invalid-comment-id",
			SigningKeyName: "bob",
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "failed to decode comment ID")
	})
}

func TestCommentUpdateAndDeleteWorkflow(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create home document
	homeDoc, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"}}},
		},
	})
	require.NoError(t, err)

	// Create original comment
	originalComment, err := alice.CreateComment(ctx, &pb.CreateCommentRequest{
		SigningKeyName: "bob",
		TargetAccount:  alice.me.Account.PublicKey.String(),
		TargetPath:     "",
		TargetVersion:  homeDoc.Version,
		Content: []*pb.BlockNode{
			{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Original content"}},
		},
	})
	require.NoError(t, err)

	// Update the comment
	updatedComment, err := alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
		Comment: &pb.Comment{
			Id:            originalComment.Id,
			TargetAccount: alice.me.Account.PublicKey.String(),
			TargetPath:    "",
			TargetVersion: homeDoc.Version,
			Author:        bob.Account.PublicKey.String(),
			Content: []*pb.BlockNode{
				{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "First update"}},
			},
		},
		SigningKeyName: "bob",
	})
	require.NoError(t, err)
	require.Equal(t, "First update", updatedComment.Content[0].Block.Text)

	// Update again
	secondUpdate, err := alice.UpdateComment(ctx, &pb.UpdateCommentRequest{
		Comment: &pb.Comment{
			Id:            originalComment.Id,
			TargetAccount: alice.me.Account.PublicKey.String(),
			TargetPath:    "",
			TargetVersion: homeDoc.Version,
			Author:        bob.Account.PublicKey.String(),
			Content: []*pb.BlockNode{
				{Block: &pb.Block{Id: "b1", Type: "paragraph", Text: "Second update"}},
			},
		},
		SigningKeyName: "bob",
	})
	require.NoError(t, err)
	require.Equal(t, "Second update", secondUpdate.Content[0].Block.Text)

	// Verify all updates have the same ID but different versions
	require.Equal(t, originalComment.Id, updatedComment.Id)
	require.Equal(t, originalComment.Id, secondUpdate.Id)
	require.NotEqual(t, originalComment.Version, updatedComment.Version)
	require.NotEqual(t, updatedComment.Version, secondUpdate.Version)

	// Finally delete the comment
	_, err = alice.DeleteComment(ctx, &pb.DeleteCommentRequest{
		Id:             originalComment.Id,
		SigningKeyName: "bob",
	})
	require.NoError(t, err)

	// Verify deletion
	_, err = alice.GetComment(ctx, &pb.GetCommentRequest{Id: originalComment.Id})
	require.Error(t, err, "comment should not be retrievable after deletion")

	// List comments and ensure the deleted comment is not present.
	listRes, err := alice.ListComments(ctx, &pb.ListCommentsRequest{
		TargetAccount: alice.me.Account.PublicKey.String(),
		TargetPath:    "",
	})
	require.NoError(t, err)

	hasDeleted := slices.ContainsFunc(listRes.Comments, func(c *pb.Comment) bool {
		return c.Id == originalComment.Id
	})
	require.False(t, hasDeleted, "deleted comment must not be in the list of comments.")
}
