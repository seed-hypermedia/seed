package documents

import (
	"context"
	"seed/backend/core/coretest"
	pb "seed/backend/genproto/documents/v3alpha"
	"seed/backend/testutil"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestListDocumentChanges(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create the initial home document.
	_, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Alice's Home Page"}}},
		},
	})
	require.NoError(t, err)

	d1, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "/cars",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Document about cars"}}},
		},
	})
	require.NoError(t, err)

	d2, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        d1.Account,
		Path:           d1.Path,
		BaseVersion:    d1.Version,
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "foo", Value: "Bar"}}},
		},
	})
	require.NoError(t, err)

	fullList, err := alice.ListDocumentChanges(ctx, &pb.ListDocumentChangesRequest{
		Account: d1.Account,
		Path:    d1.Path,
		Version: d2.Version,
	})
	require.NoError(t, err)
	require.Len(t, fullList.Changes, 2, "full list must have 2 changes")
	require.Equal(t, "", fullList.NextPageToken, "full list must not have a next page token")

	p1, err := alice.ListDocumentChanges(ctx, &pb.ListDocumentChangesRequest{
		Account:  d1.Account,
		Path:     d1.Path,
		Version:  d2.Version,
		PageSize: 1,
	})
	require.NoError(t, err)
	require.Len(t, p1.Changes, 1, "page 1 must have 1 change")
	testutil.StructsEqual(fullList.Changes[0], p1.Changes[0]).Compare(t, "first page doesn't match")

	p2, err := alice.ListDocumentChanges(ctx, &pb.ListDocumentChangesRequest{
		Account:   d1.Account,
		Path:      d1.Path,
		Version:   d2.Version,
		PageSize:  1,
		PageToken: p1.NextPageToken,
	})
	require.NoError(t, err)
	require.Len(t, p2.Changes, 1, "page 2 must have 1 change")
	testutil.StructsEqual(fullList.Changes[1], p2.Changes[0]).Compare(t, "second page doesn't match")
	require.Equal(t, "", p2.NextPageToken, "second page must not have a next page token")

	// We should be able to list changes for past versions.
	{
		list, err := alice.ListDocumentChanges(ctx, &pb.ListDocumentChangesRequest{
			Account: d1.Account,
			Path:    d1.Path,
			Version: d1.Version,
		})
		require.NoError(t, err)
		require.Len(t, list.Changes, 1, "list must have 1 change")
		testutil.StructsEqual(fullList.Changes[1], list.Changes[0]).Compare(t, "change doesn't match")
	}
}
