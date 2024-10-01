package documents

import (
	"context"
	"seed/backend/core/coretest"
	pb "seed/backend/genproto/documents/v3alpha"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCapabilities_Smoke(t *testing.T) {
	//t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	// Create the initial home document.
	_, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
		Path:           "",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Alice's Home Page"}}},
		},
	})
	require.NoError(t, err)

	// Try to create document with bob's key. It must fail.
	{
		_, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
			SigningKeyName: "bob",
			Account:        alice.me.Account.Principal().String(),
			Path:           "/cars",
			Changes: []*pb.DocumentChange{
				{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Document about cars"}}},
			},
		})
		require.Error(t, err, "bob must not be allowed to sign for alice")
	}

	// Alice creates document about cars.
	cars, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
		Path:           "/cars",
		Changes: []*pb.DocumentChange{
			{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Document about cars"}}},
		},
	})
	require.NoError(t, err)

	// Alice issued capability to bob for everything under /cars.
	cpb, err := alice.CreateCapability(ctx, &pb.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       bob.Account.Principal().String(),
		Account:        cars.Account,
		Path:           cars.Path,
		Role:           pb.Role_WRITER,
	})
	require.NoError(t, err)
	require.NotNil(t, cpb)

	// Bob creates a document under /cars.
	{
		jp, err := alice.CreateDocumentChange(ctx, &pb.CreateDocumentChangeRequest{
			SigningKeyName: "bob",
			Capability:     cpb.Id,
			Account:        alice.me.Account.Principal().String(),
			Path:           "/cars/jp",
			Changes: []*pb.DocumentChange{
				{Op: &pb.DocumentChange_SetMetadata_{SetMetadata: &pb.DocumentChange_SetMetadata{Key: "title", Value: "Catalogue of Japanese cars"}}},
			},
		})
		require.NoError(t, err, "bob must be allowed to sign for alice with the capability")
		require.NotNil(t, jp)
	}

	// Listing caps for descendant path of /cars should return inherited ones.
	list, err := alice.ListCapabilities(ctx, &pb.ListCapabilitiesRequest{
		Account: alice.me.Account.String(),
		Path:    "/cars/jp/foo",
	})
	require.NoError(t, err)
	require.Len(t, list.Capabilities, 1, "must return the capability")
}
