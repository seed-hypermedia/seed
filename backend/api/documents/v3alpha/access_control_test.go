package documents

import (
	"context"
	"seed/backend/core/coretest"
	. "seed/backend/genproto/documents/v3alpha"
	documents "seed/backend/genproto/documents/v3alpha"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCapabilities_Smoke(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := coretest.NewTester("bob")
	ctx := context.Background()
	require.NoError(t, alice.keys.StoreKey(ctx, "bob", bob.Account))

	_, err := alice.CreateDocumentChange(ctx, &CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
		Path:           "",
		Changes: []*DocumentChange{
			{Op: &DocumentChange_SetMetadata_{SetMetadata: &DocumentChange_SetMetadata{Key: "title", Value: "Alice's Home Page"}}},
		},
	})
	require.NoError(t, err)

	{
		_, err := alice.CreateDocumentChange(ctx, &CreateDocumentChangeRequest{
			SigningKeyName: "bob",
			Account:        alice.me.Account.Principal().String(),
			Path:           "/cars",
			Changes: []*DocumentChange{
				{Op: &DocumentChange_SetMetadata_{SetMetadata: &DocumentChange_SetMetadata{Key: "title", Value: "Document about cars"}}},
			},
		})
		require.Error(t, err, "bob must not be allowed to sign for alice")
	}

	cars, err := alice.CreateDocumentChange(ctx, &CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
		Path:           "/cars",
		Changes: []*DocumentChange{
			{Op: &DocumentChange_SetMetadata_{SetMetadata: &DocumentChange_SetMetadata{Key: "title", Value: "Document about cars"}}},
		},
	})
	require.NoError(t, err)

	cpb, err := alice.CreateCapability(ctx, &CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       bob.Account.Principal().String(),
		Account:        cars.Account,
		Path:           cars.Path,
		Role:           documents.Role_WRITER,
	})
	require.NoError(t, err)
	require.NotNil(t, cpb)

	{
		jp, err := alice.CreateDocumentChange(ctx, &CreateDocumentChangeRequest{
			SigningKeyName: "bob",
			Capability:     cpb.Id,
			Account:        alice.me.Account.Principal().String(),
			Path:           "/cars/jp",
			Changes: []*DocumentChange{
				{Op: &DocumentChange_SetMetadata_{SetMetadata: &DocumentChange_SetMetadata{Key: "title", Value: "Catalogue of Japanese cars"}}},
			},
		})
		require.NoError(t, err, "bob must be allowed to sign for alice with the capability")
		require.NotNil(t, jp)
	}

	list, err := alice.ListCapabilities(ctx, &ListCapabilitiesRequest{
		Account: alice.me.Account.String(),
		Path:    "/cars/jp/foo",
	})
	require.NoError(t, err)
	require.Len(t, list.Capabilities, 1, "must return the capability")
}
