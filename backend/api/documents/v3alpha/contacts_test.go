package documents

import (
	"context"
	"seed/backend/blob"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/testutil"
	"testing"
	"time"

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
	require.Equal(t, alice.me.Account.PublicKey.String(), contact.Signer)
	require.NotNil(t, contact.CreateTime)
	require.NotNil(t, contact.UpdateTime)
	require.NotEqual(t, "", contact.Id, "must have ID")

	// Verify the contact can be retrieved with GetContact.
	retrievedContact, err := alice.GetContact(ctx, &documents.GetContactRequest{
		Id: contact.Id,
	})
	require.NoError(t, err)
	testutil.StructsEqual(contact, retrievedContact).Compare(t, "created and retrieved contacts should be equal")

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

func TestDelegatedContactSigner(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	delegate := coretest.NewTester("bob")
	subject := coretest.NewTester("carol")

	require.NoError(t, alice.keys.StoreKey(ctx, "delegate", delegate.Account))

	_, err := alice.CreateCapability(ctx, &documents.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       delegate.Account.PublicKey.String(),
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Role:           documents.Role_AGENT,
	})
	require.NoError(t, err)

	contact, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "delegate",
		Subject:        subject.Account.PublicKey.String(),
		Name:           "Delegated Subject",
	})
	require.NoError(t, err)
	require.Equal(t, alice.me.Account.PublicKey.String(), contact.Account)
	require.Equal(t, delegate.Account.PublicKey.String(), contact.Signer)

	recordID, err := blob.DecodeRecordID(contact.Id)
	require.NoError(t, err)
	require.Equal(t, alice.me.Account.Principal().String(), recordID.Authority.String())

	retrieved, err := alice.GetContact(ctx, &documents.GetContactRequest{Id: contact.Id})
	require.NoError(t, err)
	testutil.StructsEqual(contact, retrieved).Compare(t, "delegated contact mismatch")

	resp, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
		Filter: &documents.ListContactsRequest_Account{
			Account: alice.me.Account.PublicKey.String(),
		},
	})
	require.NoError(t, err)
	require.Len(t, resp.Contacts, 1)
	testutil.StructsEqual(contact, resp.Contacts[0]).Compare(t, "delegated contact list mismatch")
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

	bobContact, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        bob.Account.PublicKey.String(),
		Name:           "Bob",
	})
	require.NoError(t, err)

	carolContact, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        carol.Account.PublicKey.String(),
		Name:           "Carol",
	})
	require.NoError(t, err)

	aliceContactBob, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        bob.Account.PublicKey.String(),
		SigningKeyName: "bob-key",
		Subject:        alice.me.Account.PublicKey.String(),
		Name:           "Alice",
	})
	require.NoError(t, err)

	aliceContactDavid, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
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
		require.Len(t, resp.Contacts, 2) // Now we expect 2 contacts (from Bob and David)

		// Contacts should be sorted by timestamp, with most recent first
		// Since we're creating Carol's contact after Bob's, Carol should be first
		testutil.StructsEqual(carolContact, resp.Contacts[0]).Compare(t, "Carol contact mismatch")
		testutil.StructsEqual(bobContact, resp.Contacts[1]).Compare(t, "Bob contact mismatch")
	})

	t.Run("list by subject", func(t *testing.T) {
		resp, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 10,
			Filter: &documents.ListContactsRequest_Subject{
				Subject: alice.me.Account.PublicKey.String(),
			},
		})
		require.NoError(t, err)
		require.Len(t, resp.Contacts, 2)

		testutil.StructsEqual(aliceContactDavid, resp.Contacts[0]).Compare(t, "Alice (David) contact mismatch")
		testutil.StructsEqual(aliceContactBob, resp.Contacts[1]).Compare(t, "Alice (Bob) contact mismatch")
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

func TestUpdateContact(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	bob := coretest.NewTester("bob")
	carol := coretest.NewTester("carol")

	// Create initial contact
	originalContact, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        bob.Account.PublicKey.String(),
		Name:           "Bob",
	})
	require.NoError(t, err)

	t.Run("successfully update contact", func(t *testing.T) {
		// Update the contact with new name and subject
		updatedContact, err := alice.UpdateContact(ctx, &documents.UpdateContactRequest{
			Contact: &documents.Contact{
				Id:      originalContact.Id,
				Account: alice.me.Account.PublicKey.String(),
				Subject: carol.Account.PublicKey.String(),
				Name:    "Carol (Updated)",
			},
			SigningKeyName: "main",
		})
		require.NoError(t, err)
		require.NotNil(t, updatedContact)

		// Verify updated fields
		require.Equal(t, originalContact.Id, updatedContact.Id, "ID should remain the same")
		require.Equal(t, carol.Account.PublicKey.String(), updatedContact.Subject, "Subject should be updated")
		require.Equal(t, "Carol (Updated)", updatedContact.Name, "Name should be updated")
		require.Equal(t, alice.me.Account.PublicKey.String(), updatedContact.Account, "Account should remain the same")

		// Verify timestamps
		require.Equal(t, originalContact.CreateTime, updatedContact.CreateTime, "Create time should remain the same")
		require.True(t, updatedContact.UpdateTime.AsTime().After(originalContact.UpdateTime.AsTime()), "Update time should be newer")

		// Verify the contact can be retrieved with the updated data
		retrievedContact, err := alice.GetContact(ctx, &documents.GetContactRequest{
			Id: originalContact.Id,
		})
		require.NoError(t, err)
		testutil.StructsEqual(updatedContact, retrievedContact).Compare(t, "updated and retrieved contacts should be equal")
	})

	t.Run("missing required fields", func(t *testing.T) {
		// Missing contact
		_, err := alice.UpdateContact(ctx, &documents.UpdateContactRequest{
			SigningKeyName: "main",
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())

		// Missing contact ID
		_, err = alice.UpdateContact(ctx, &documents.UpdateContactRequest{
			Contact: &documents.Contact{
				Account: alice.me.Account.PublicKey.String(),
				Subject: bob.Account.PublicKey.String(),
				Name:    "Bob Updated",
			},
			SigningKeyName: "main",
		})
		require.Error(t, err)
		st, _ = status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())

		// Missing signing key name
		_, err = alice.UpdateContact(ctx, &documents.UpdateContactRequest{
			Contact: &documents.Contact{
				Id:      originalContact.Id,
				Account: alice.me.Account.PublicKey.String(),
				Subject: bob.Account.PublicKey.String(),
				Name:    "Bob Updated",
			},
		})
		require.Error(t, err)
		st, _ = status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})

	t.Run("invalid account", func(t *testing.T) {
		_, err := alice.UpdateContact(ctx, &documents.UpdateContactRequest{
			Contact: &documents.Contact{
				Id:      originalContact.Id,
				Account: "invalid-account",
				Subject: bob.Account.PublicKey.String(),
				Name:    "Bob Updated",
			},
			SigningKeyName: "main",
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})

	t.Run("invalid subject", func(t *testing.T) {
		_, err := alice.UpdateContact(ctx, &documents.UpdateContactRequest{
			Contact: &documents.Contact{
				Id:      originalContact.Id,
				Account: alice.me.Account.PublicKey.String(),
				Subject: "invalid-subject",
				Name:    "Bob Updated",
			},
			SigningKeyName: "main",
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})
}

func TestDeleteContact(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	bob := coretest.NewTester("bob")

	// Create contact to delete
	contact, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        bob.Account.PublicKey.String(),
		Name:           "Bob",
	})
	require.NoError(t, err)

	t.Run("successfully delete contact", func(t *testing.T) {
		// Delete the contact
		_, err = alice.DeleteContact(ctx, &documents.DeleteContactRequest{
			Id:             contact.Id,
			SigningKeyName: "main",
		})
		require.NoError(t, err)

		// Verify the contact can no longer be retrieved
		_, err = alice.GetContact(ctx, &documents.GetContactRequest{
			Id: contact.Id,
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.NotFound, st.Code())

		// Verify the contact doesn't appear in list
		resp, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 10,
			Filter: &documents.ListContactsRequest_Account{
				Account: alice.me.Account.PublicKey.String(),
			},
		})
		require.NoError(t, err)
		require.Len(t, resp.Contacts, 0, "Deleted contact should not appear in list")
	})

	t.Run("missing required fields", func(t *testing.T) {
		// Missing ID
		_, err := alice.DeleteContact(ctx, &documents.DeleteContactRequest{
			SigningKeyName: "main",
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())

		// Missing signing key name
		_, err = alice.DeleteContact(ctx, &documents.DeleteContactRequest{
			Id: contact.Id,
		})
		require.Error(t, err)
		st, _ = status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})

	t.Run("invalid contact ID", func(t *testing.T) {
		_, err := alice.DeleteContact(ctx, &documents.DeleteContactRequest{
			Id:             "invalid-contact-id",
			SigningKeyName: "main",
		})
		require.Error(t, err)
		st, _ := status.FromError(err)
		require.Equal(t, codes.InvalidArgument, st.Code())
	})
}

func TestContactUpdateAndDeleteWorkflow(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	bob := coretest.NewTester("bob")
	carol := coretest.NewTester("carol")

	// Create initial contact
	originalContact, err := alice.CreateContact(ctx, &documents.CreateContactRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Subject:        bob.Account.PublicKey.String(),
		Name:           "Bob",
	})
	require.NoError(t, err)

	// Update the contact
	updatedContact, err := alice.UpdateContact(ctx, &documents.UpdateContactRequest{
		Contact: &documents.Contact{
			Id:      originalContact.Id,
			Account: alice.me.Account.PublicKey.String(),
			Subject: carol.Account.PublicKey.String(),
			Name:    "Carol (Updated from Bob)",
		},
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	// Verify the update shows in list
	resp, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
		PageSize: 10,
		Filter: &documents.ListContactsRequest_Account{
			Account: alice.me.Account.PublicKey.String(),
		},
	})
	require.NoError(t, err)
	require.Len(t, resp.Contacts, 1)
	testutil.StructsEqual(updatedContact, resp.Contacts[0]).Compare(t, "Updated contact should appear in list")

	// Update again with different name
	secondUpdate, err := alice.UpdateContact(ctx, &documents.UpdateContactRequest{
		Contact: &documents.Contact{
			Id:      originalContact.Id,
			Account: alice.me.Account.PublicKey.String(),
			Subject: carol.Account.PublicKey.String(),
			Name:    "Carol (Final Update)",
		},
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	// Verify only the latest version appears
	retrievedContact, err := alice.GetContact(ctx, &documents.GetContactRequest{
		Id: originalContact.Id,
	})
	require.NoError(t, err)
	testutil.StructsEqual(secondUpdate, retrievedContact).Compare(t, "Should get the latest updated version")

	// Now delete the contact
	_, err = alice.DeleteContact(ctx, &documents.DeleteContactRequest{
		Id:             originalContact.Id,
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	// Verify it's gone from everywhere
	_, err = alice.GetContact(ctx, &documents.GetContactRequest{
		Id: originalContact.Id,
	})
	require.Error(t, err)
	st, _ := status.FromError(err)
	require.Equal(t, codes.NotFound, st.Code())

	resp, err = alice.ListContacts(ctx, &documents.ListContactsRequest{
		PageSize: 10,
		Filter: &documents.ListContactsRequest_Account{
			Account: alice.me.Account.PublicKey.String(),
		},
	})
	require.NoError(t, err)
	require.Len(t, resp.Contacts, 0, "Deleted contact should not appear in list")
}

func TestContactSubscribeMetadata(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	bob := coretest.NewTester("bob")

	// Create a contact with subscribe metadata directly using the blob API.
	subscribe := &blob.ContactSubscribe{Site: true}
	eb := mustCreateContactWithSubscribe(ctx, t, alice.idx, &alice.me, "", bob.Account.Principal(), "Bob Site", subscribe, time.Now())

	contactID := blob.RecordID{
		Authority: alice.me.Account.Principal(),
		TSID:      eb.TSID(),
	}.String()

	t.Run("GetContact returns subscribe metadata", func(t *testing.T) {
		contact, err := alice.GetContact(ctx, &documents.GetContactRequest{
			Id: contactID,
		})
		require.NoError(t, err)
		require.NotNil(t, contact)
		require.Equal(t, "Bob Site", contact.Name)

		// Verify subscribe metadata is present.
		require.NotNil(t, contact.Metadata, "Metadata should be present")
		subscribeMeta := contact.Metadata.Fields["subscribe"]
		require.NotNil(t, subscribeMeta, "subscribe field should be present in metadata")

		subscribeStruct := subscribeMeta.GetStructValue()
		require.NotNil(t, subscribeStruct, "subscribe should be a struct")
		site := subscribeStruct.Fields["site"]
		require.NotNil(t, site, "site field should be present")
		require.True(t, site.GetBoolValue(), "site should be true")
	})

	t.Run("ListContacts returns subscribe metadata", func(t *testing.T) {
		resp, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
			PageSize: 10,
			Filter: &documents.ListContactsRequest_Account{
				Account: alice.me.Account.PublicKey.String(),
			},
		})
		require.NoError(t, err)
		require.Len(t, resp.Contacts, 1)

		contact := resp.Contacts[0]
		require.Equal(t, "Bob Site", contact.Name)

		// Verify subscribe metadata is present.
		require.NotNil(t, contact.Metadata, "Metadata should be present")
		subscribeMeta := contact.Metadata.Fields["subscribe"]
		require.NotNil(t, subscribeMeta, "subscribe field should be present in metadata")

		subscribeStruct := subscribeMeta.GetStructValue()
		require.NotNil(t, subscribeStruct, "subscribe should be a struct")
		site := subscribeStruct.Fields["site"]
		require.NotNil(t, site, "site field should be present")
		require.True(t, site.GetBoolValue(), "site should be true")
	})
}

// TestListContactsBySubjectWithTombstone verifies that when querying contacts by subject,
// tombstones properly filter out deleted contacts even when the tombstone is signed by
// a different key than the original contact (e.g., web linked accounts scenario).
func TestListContactsBySubjectWithTombstone(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create bob as the subject of the contact.
	bob := coretest.NewTester("bob")

	// Create a delegate key that will act on behalf of alice's account.
	// Using carol's account as a "linked key" for alice (simulating web linked accounts).
	delegate := coretest.NewTester("carol")

	// All times must be rounded for blob encoding.
	now := time.Now().Round(blob.ClockPrecision)

	// Grant the delegate key WRITER capability for alice's account.
	capability, err := blob.NewCapability(
		alice.me.Account,
		delegate.Account.Principal(),
		alice.me.Account.Principal(),
		"",       // empty path = root level access
		"WRITER", // role
		"",       // label
		now,
	)
	require.NoError(t, err)
	require.NoError(t, alice.idx.Put(ctx, capability))

	// Create a contact from alice to bob using alice's main key.
	contact, err := blob.NewContact(
		alice.me.Account,
		"", // empty TSID = generate new one
		alice.me.Account.Principal(),
		bob.Account.Principal(),
		"Bob",
		nil,
		now,
	)
	require.NoError(t, err)
	require.NoError(t, alice.idx.Put(ctx, contact))

	// Verify the contact appears in ListContacts by subject.
	resp, err := alice.ListContacts(ctx, &documents.ListContactsRequest{
		PageSize: 10,
		Filter: &documents.ListContactsRequest_Subject{
			Subject: bob.Account.PublicKey.String(),
		},
	})
	require.NoError(t, err)
	require.Len(t, resp.Contacts, 1, "Contact should appear when querying by subject")
	require.Equal(t, "Bob", resp.Contacts[0].Name)

	// Create a tombstone for the contact using the DELEGATE key (different signer).
	// This simulates the web linked accounts scenario where the user deletes a contact
	// using a different key than the one that created it.
	tombstoneTime := now.Add(time.Second)
	tombstone, err := blob.NewContact(
		delegate.Account,             // Different signer!
		contact.TSID(),               // Same TSID as original contact
		alice.me.Account.Principal(), // Same account
		nil,                          // nil subject = tombstone
		"",                           // empty name for tombstone
		nil,
		tombstoneTime,
	)
	require.NoError(t, err)
	require.NoError(t, alice.idx.Put(ctx, tombstone))

	// Verify the contact is now filtered out when querying by subject.
	// The tombstone has a later timestamp, so it should "win" in the ROW_NUMBER partition.
	resp, err = alice.ListContacts(ctx, &documents.ListContactsRequest{
		PageSize: 10,
		Filter: &documents.ListContactsRequest_Subject{
			Subject: bob.Account.PublicKey.String(),
		},
	})
	require.NoError(t, err)
	require.Len(t, resp.Contacts, 0, "Tombstoned contact should not appear when querying by subject")

	// Also verify GetContact returns not found.
	contactID := blob.RecordID{
		Authority: alice.me.Account.Principal(),
		TSID:      contact.TSID(),
	}.String()
	_, err = alice.GetContact(ctx, &documents.GetContactRequest{
		Id: contactID,
	})
	require.Error(t, err)
	st, _ := status.FromError(err)
	require.Equal(t, codes.NotFound, st.Code(), "GetContact should return NotFound for tombstoned contact")

	// Also verify the contact is filtered out when querying by account.
	resp, err = alice.ListContacts(ctx, &documents.ListContactsRequest{
		PageSize: 10,
		Filter: &documents.ListContactsRequest_Account{
			Account: alice.me.Account.PublicKey.String(),
		},
	})
	require.NoError(t, err)
	require.Len(t, resp.Contacts, 0, "Tombstoned contact should not appear when querying by account")
}
