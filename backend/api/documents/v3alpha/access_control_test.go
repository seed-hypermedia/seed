package documents

import (
	"context"
	"seed/backend/api/apitest"
	"seed/backend/core/coretest"
	pb "seed/backend/genproto/documents/v3alpha"
	"seed/backend/testutil"
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

	// Bob creates a document under /cars.
	{
		jp, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), "/cars/jp", "", "bob").
			SetCapability(cpb.Id).
			SetMetadata("title", "Catalogue of Japanese cars").
			Build(),
		)
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
	testutil.StructsEqual(cpb, list.Capabilities[0]).Compare(t, "must return the capability")

	{
		list, err := alice.ListCapabilitiesForDelegate(ctx, &pb.ListCapabilitiesForDelegateRequest{
			Delegate: bob.Account.PublicKey.String(),
		})
		require.NoError(t, err)
		require.Len(t, list.Capabilities, 1, "must return the capability")
		testutil.StructsEqual(cpb, list.Capabilities[0]).Compare(t, "must return the capability")
	}
}
