package documents

import (
	"context"
	"seed/backend/api/apitest"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	pb "seed/backend/genproto/documents/v3alpha"
	"seed/backend/testutil"
	"seed/backend/util/colx"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCapabilities_Smoke(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create the initial home document.
	_, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), "", "", "main").
		SetMetadata("title", "Alice's Home Page").
		Build(),
	)
	require.NoError(t, err)

	// Try to create document with bob's key. It must fail.
	{
		_, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), "/cars", "", "bob").
			SetMetadata("title", "Document about cars").
			Build(),
		)
		require.Error(t, err, "bob must not be allowed to sign for alice")
	}

	// Alice creates document about cars.
	cars, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), "/cars", "", "main").
		SetMetadata("title", "Document about cars").
		Build(),
	)
	require.NoError(t, err)

	// Alice issued capability to bob for everything under /cars.
	cpb, err := alice.CreateCapability(ctx, &pb.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       bob.Account.PublicKey.String(),
		Account:        cars.Account,
		Path:           cars.Path,
		Role:           pb.Role_WRITER,
	})
	require.NoError(t, err)
	require.NotNil(t, cpb)

	// Listing caps for descendant path of /cars should return inherited ones.
	list, err := alice.ListCapabilities(ctx, &pb.ListCapabilitiesRequest{
		Account: alice.me.Account.String(),
		Path:    "/cars/jp/foo",
	})
	require.NoError(t, err)
	require.Len(t, list.Capabilities, 1, "must return the capability")
	testutil.StructsEqual(cpb, list.Capabilities[0]).Compare(t, "must return the capability")

	{
		list, err := alice.ListCapabilitiesForDelegate(ctx, &pb.ListCapabilitiesForDelegateRequest{
			Delegate: bob.Account.PublicKey.String(),
		})
		require.NoError(t, err)
		require.Len(t, list.Capabilities, 1, "must return the capability")
		testutil.StructsEqual(cpb, list.Capabilities[0]).Compare(t, "must return the capability")
	}

	// Bob creates a document under /cars.
	{
		jp, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), "/cars/jp", "", "bob").
			SetMetadata("title", "Catalogue of Japanese cars").
			Build(),
		)
		require.NoError(t, err, "bob must be allowed to sign for alice with the capability")
		require.NotNil(t, jp)
	}
}

func TestWriterCollaboratorPermissions(t *testing.T) {
	t.Parallel()

	// Initialize test users
	owner := newTestDocsAPI(t, "alice")
	writer := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, owner.keys.StoreKey(ctx, "writer", writer.Account))

	// Create the initial workspace document
	workspace, err := owner.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        owner.me.Account.PublicKey.String(),
		Path:           "/workspace",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Test Workspace"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, workspace)

	// Create a subdocument in the workspace
	doc1, err := owner.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        owner.me.Account.PublicKey.String(),
		Path:           "/workspace/doc1",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Document 1"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, doc1)

	// Add writer collaborator to the workspace
	cap, err := owner.CreateCapability(ctx, &documents.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       writer.Account.PublicKey.String(),
		Account:        workspace.Account,
		Path:           workspace.Path,
		Role:           documents.Role_WRITER,
	})
	require.NoError(t, err)
	require.NotNil(t, cap)

	// Verify writer can create a new document
	doc2, err := owner.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "writer",
		Account:        owner.me.Account.PublicKey.String(),
		Path:           "/workspace/doc2",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Document 2"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, doc2)

	// Verify writer can fork a document.
	movedDoc, err := owner.CreateRef(ctx, &documents.CreateRefRequest{
		SigningKeyName: "writer",
		Account:        owner.me.Account.PublicKey.String(),
		Path:           "/workspace/subfolder/doc2",
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Version_{
				Version: &documents.RefTarget_Version{
					Genesis: doc2.GenerationInfo.Genesis,
					Version: doc2.Version,
				},
			}},
	})
	require.NoError(t, err)
	require.NotNil(t, movedDoc)

	// Verify writer can delete a document by creating a tombstone ref
	_, err = owner.CreateRef(ctx, &documents.CreateRefRequest{
		SigningKeyName: "writer",
		Account:        doc2.Account,
		Path:           doc2.Path,
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Tombstone_{
				Tombstone: &documents.RefTarget_Tombstone{},
			},
		},
	})
	require.NoError(t, err)

	list, err := owner.ListDocuments(ctx, &documents.ListDocumentsRequest{
		Account: owner.me.Account.String(),
	})
	require.NoError(t, err)

	paths := colx.SliceMap(list.Documents, (*documents.DocumentInfo).GetPath)
	slices.Sort(paths)

	want := []string{"/workspace", "/workspace/doc1", "/workspace/subfolder/doc2"}
	require.Equal(t, want, paths, "listed paths must match")
}
