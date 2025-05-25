package documents

import (
	"context"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCreateContact(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create a second tester to act as the subject.
	bob := coretest.NewTester("bob")

	// Test case: Successfully create a contact.
	contact, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        bob.Account.PublicKey.String(),
		Name:           "Bob",
	})
	require.NoError(t, err)
	require.NotNil(t, contact)
	require.Equal(t, bob.Account.PublicKey.String(), contact.Subject)
	require.Equal(t, "Bob", contact.Name)
	require.Equal(t, alice.me.Account.PublicKey.String(), contact.Account)
	require.NotNil(t, contact.CreateTime)
	require.NotNil(t, contact.UpdateTime)

	// Test case: Missing required fields.
	_, err = alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		// Missing Subject and Name
	})
	require.Error(t, err)
	st, _ := status.FromError(err)
	require.Equal(t, codes.InvalidArgument, st.Code())

	// Test case: Invalid account.
	_, err = alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        "invalid-account",
		SigningKeyName: "main",
		Subject:        bob.Account.PublicKey.String(),
		Name:           "Bob",
	})
	require.Error(t, err)
	st, _ = status.FromError(err)
	require.Equal(t, codes.InvalidArgument, st.Code())

	// Test case: Invalid subject.
	_, err = alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        "invalid-subject",
		Name:           "Bob",
	})
	require.Error(t, err)
	st, _ = status.FromError(err)
	require.Equal(t, codes.InvalidArgument, st.Code())
}

func TestListContacts(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	bob := coretest.NewTester("bob")
	carol := coretest.NewTester("carol")
	david := coretest.NewTester("david")

	require.NoError(t, alice.keys.StoreKey(ctx, "bob-key", bob.Account))
	require.NoError(t, alice.keys.StoreKey(ctx, "carol-key", carol.Account))
	require.NoError(t, alice.keys.StoreKey(ctx, "david-key", david.Account))

	_, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        bob.Account.PublicKey.String(),
		Name:           "Bob",
	})
	require.NoError(t, err)

	_, err = alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        carol.Account.PublicKey.String(),
		Name:           "Carol",
	})
	require.NoError(t, err)

	_, err = alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        bob.Account.PublicKey.String(),
		SigningKeyName: "bob-key",
		Subject:        alice.me.Account.PublicKey.String(),
		Name:           "Alice",
	})
	require.NoError(t, err)

	_, err = alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        david.Account.PublicKey.String(),
		SigningKeyName: "david-key",
		Subject:        alice.me.Account.PublicKey.String(),
		Name:           "Alice",
	})
	require.NoError(t, err)

	t.Run("list by account", func(t *testing.T) {
		resp, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 10,
			Filter: &documents.ListContactsRequest_Account{
				Account: alice.me.Account.PublicKey.String(),
			},
		})
		require.NoError(t, err)
		require.Len(t, resp.Contacts, 2)

		// Contacts should be sorted by timestamp, with most recent first
		// Since we're creating Carol's contact after Bob's, Carol should be first
		require.Equal(t, "Carol", resp.Contacts[0].Name)
		require.Equal(t, carol.Account.PublicKey.String(), resp.Contacts[0].Subject)
		require.Equal(t, "Bob", resp.Contacts[1].Name)
		require.Equal(t, bob.Account.PublicKey.String(), resp.Contacts[1].Subject)
	})

	t.Run("list by subject", func(t *testing.T) {
		resp, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 10,
			Filter: &documents.ListContactsRequest_Subject{
				Subject: alice.me.Account.PublicKey.String(),
			},
		})
		require.NoError(t, err)
		require.Len(t, resp.Contacts, 2) // Now we expect 2 contacts (from Bob and David)

		require.Equal(t, "Alice", resp.Contacts[0].Name)
		require.Equal(t, alice.me.Account.PublicKey.String(), resp.Contacts[0].Subject)
		require.Equal(t, david.Account.PublicKey.String(), resp.Contacts[0].Account)

		require.Equal(t, "Alice", resp.Contacts[1].Name)
		require.Equal(t, alice.me.Account.PublicKey.String(), resp.Contacts[1].Subject)
		require.Equal(t, bob.Account.PublicKey.String(), resp.Contacts[1].Account)
	})

	t.Run("pagination", func(t *testing.T) {
		// Test pagination with the 2 contacts we already have
		// First page should get 1 contact
		firstPage, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 1,
			Filter: &documents.ListContactsRequest_Account{
				Account: alice.me.Account.PublicKey.String(),
			},
		})
		require.NoError(t, err)
		require.Len(t, firstPage.Contacts, 1)
		require.NotEmpty(t, firstPage.NextPageToken, "Should have next page token when more contacts exist")

		// Second page should get the remaining contact
		secondPage, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize:  1,
			PageToken: firstPage.NextPageToken,
			Filter: &documents.ListContactsRequest_Account{
				Account: alice.me.Account.PublicKey.String(),
			},
		})
		require.NoError(t, err)
		require.Len(t, secondPage.Contacts, 1)
		require.Empty(t, secondPage.NextPageToken, "Should not have next page token on last page")

		// Verify contacts are different
		require.NotEqual(t, firstPage.Contacts[0].Name, secondPage.Contacts[0].Name)
	})

	// Test missing required filter
	t.Run("missing filter", func(t *testing.T) {
		_, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 10,
			// No filter
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})

	t.Run("invalid account", func(t *testing.T) {
		_, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 10,
			Filter: &documents.ListContactsRequest_Account{
				Account: "invalid-account",
			},
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})

	t.Run("invalid subject", func(t *testing.T) {
		_, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 10,
			Filter: &documents.ListContactsRequest_Subject{
				Subject: "invalid-subject",
			},
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})

	t.Run("invalid page token", func(t *testing.T) {
		_, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize:  10,
			PageToken: "invalid-token",
			Filter: &documents.ListContactsRequest_Account{
				Account: alice.me.Account.PublicKey.String(),
			},
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})
}
