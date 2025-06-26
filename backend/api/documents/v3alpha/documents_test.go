package documents

import (
	"cmp"
	"context"
	"seed/backend/api/apitest"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"slices"
	"strings"
	"testing"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestCreateDocumentChange(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice from the Wonderland"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Hello",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b2", Parent: "b1", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b2",
					Type: "paragraph",
					Text: "World!",
				},
			}},
		},
	})
	require.NoError(t, err)

	want := &documents.Document{
		Account: alice.me.Account.PublicKey.String(),
		Path:    "",
		Metadata: must.Do2(structpb.NewStruct(map[string]any{
			"title": "Alice from the Wonderland",
		})),
		Authors: []string{alice.me.Account.PublicKey.String()},
		Content: []*documents.BlockNode{
			{
				Block: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Hello",
				},
				Children: []*documents.BlockNode{
					{
						Block: &documents.Block{
							Id:   "b2",
							Type: "paragraph",
							Text: "World!",
						},
					},
				},
			},
		},
	}

	testutil.StructsEqual(want, doc).
		IgnoreFields(documents.Block{}, "Revision").
		IgnoreFields(documents.Document{}, "CreateTime", "UpdateTime", "Version", "Genesis", "GenerationInfo").
		Compare(t, "profile document must match")
}

func TestListRootDocuments(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create root document for Alice.
	profile, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice's profile"},
			}},
		},
	})
	require.NoError(t, err)

	// Create a named doc for Alice to make sure only roots are returned in list requests.
	namedDoc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "/named/foo",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Named document"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, namedDoc)

	// Create root doc for Bob and make sure Alice has it too.
	var bobsRoot *documents.DocumentInfo
	{
		bob := newTestDocsAPI(t, "bob")
		_, err = bob.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        bob.me.Account.PublicKey.String(),
			Path:           "",
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob's profile"},
				}},
			},
		})
		require.NoError(t, err)

		roots, err := bob.ListRootDocuments(ctx, &documents.ListRootDocumentsRequest{})
		require.NoError(t, err)
		require.Len(t, roots.Documents, 1)
		bobsRoot = roots.Documents[0]

		cids, err := bob.idx.AllKeysChan(ctx)
		require.NoError(t, err)
		var count int
		for c := range cids {
			count++
			blk, err := bob.idx.Get(ctx, c)
			require.NoError(t, err)
			err = alice.idx.Put(ctx, blk)
			require.NoError(t, err)
		}
		require.Greater(t, count, 0)
	}

	roots, err := alice.ListRootDocuments(ctx, &documents.ListRootDocumentsRequest{})
	require.NoError(t, err)

	require.Len(t, roots.Documents, 2)
	require.Equal(t, "", roots.NextPageToken, "must have no page token for a single item")

	wantAlicesRoot := DocumentToListItem(profile)

	testutil.StructsEqual(bobsRoot, roots.Documents[0]).
		IgnoreFields(documents.DocumentInfo{}, "Breadcrumbs", "ActivitySummary").
		Compare(t, "bobs root document must match and be first")

	testutil.StructsEqual(wantAlicesRoot, roots.Documents[1]).
		IgnoreFields(documents.DocumentInfo{}, "Breadcrumbs", "ActivitySummary").
		Compare(t, "alice's root document must match and be second")
}

func TestListAccounts(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create root document for Alice.
	aliceRoot, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice's profile"},
			}},
		},
	})
	require.NoError(t, err)

	aliceAcc := &documents.Account{
		Id:       aliceRoot.Account,
		Metadata: aliceRoot.Metadata,
		ActivitySummary: &documents.ActivitySummary{
			CommentCount:      0,
			LatestChangeTime:  aliceRoot.UpdateTime,
			LatestCommentTime: nil,
		},
	}

	accs, err := alice.ListAccounts(ctx, &documents.ListAccountsRequest{})
	require.NoError(t, err)
	require.Len(t, accs.Accounts, 1)
	testutil.StructsEqual(aliceAcc, accs.Accounts[0]).Compare(t, "alice's account must match")

	bob := newTestDocsAPI(t, "bob")
	bobRoot, err := bob.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        bob.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob's profile"},
			}},
		},
	})
	require.NoError(t, err)

	bobAcc := &documents.Account{
		Id:       bobRoot.Account,
		Metadata: bobRoot.Metadata,
		ActivitySummary: &documents.ActivitySummary{
			CommentCount:      0,
			LatestChangeTime:  bobRoot.UpdateTime,
			LatestCommentTime: nil,
		},
	}

	accs, err = bob.ListAccounts(ctx, &documents.ListAccountsRequest{})
	require.NoError(t, err)
	require.Len(t, accs.Accounts, 1)
	testutil.StructsEqual(bobAcc, accs.Accounts[0]).Compare(t, "bob's account must match")

	// Sync bob to alice.
	syncStores(ctx, t, alice.idx, bob.idx)

	accs, err = alice.ListAccounts(ctx, &documents.ListAccountsRequest{})
	require.NoError(t, err)
	require.Len(t, accs.Accounts, 2)

	testutil.StructsEqual(bobAcc, accs.Accounts[0]).
		IgnoreTypes(&documents.Breadcrumb{}, &documents.ActivitySummary{}).
		Compare(t, "bobs root document must match and be first")

	testutil.StructsEqual(aliceAcc, accs.Accounts[1]).
		IgnoreTypes(&documents.Breadcrumb{}, &documents.ActivitySummary{}).
		Compare(t, "alice's root document must match and be second")
}

func TestListDocuments(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	profile, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice's profile"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, profile)

	// Create a named doc for Alice to make sure we have things to list.
	namedDoc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "/named/foo",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Named document"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, namedDoc)

	namedDoc2, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "/named/bar",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Named document 2"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, namedDoc2)

	list, err := alice.ListDocuments(ctx, &documents.ListDocumentsRequest{Account: alice.me.Account.PublicKey.String()})
	require.NoError(t, err)

	want := []*documents.DocumentInfo{DocumentToListItem(namedDoc2), DocumentToListItem(namedDoc), DocumentToListItem(profile)}
	require.Len(t, list.Documents, len(want))

	testutil.StructsEqual(want[0], list.Documents[0]).
		IgnoreFields(documents.DocumentInfo{}, "Breadcrumbs", "ActivitySummary").
		Compare(t, "named2 must be the first doc in the list")

	testutil.StructsEqual(want[1], list.Documents[1]).
		IgnoreFields(documents.DocumentInfo{}, "Breadcrumbs", "ActivitySummary").
		Compare(t, "named must be the second doc in the list")

	testutil.StructsEqual(want[2], list.Documents[2]).
		IgnoreFields(documents.DocumentInfo{}, "Breadcrumbs", "ActivitySummary").
		Compare(t, "profile doc must be the last element in the list")

	list2, err := alice.ListDocuments(ctx, &documents.ListDocumentsRequest{})
	require.NoError(t, err)

	testutil.StructsEqual(list, list2).Compare(t, "list with no account ID must be allowed")
}

func TestGetDocumentWithVersion(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice from the Wonderland"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Hello",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b2", Parent: "b1", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b2",
					Type: "paragraph",
					Text: "World!",
				},
			}},
		},
	})
	require.NoError(t, err)

	doc2, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		BaseVersion:    doc.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_DeleteBlock{DeleteBlock: "b2"}},
		},
	})
	require.NoError(t, err)

	doc3, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		BaseVersion:    doc2.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_ReplaceBlock{ReplaceBlock: &documents.Block{
				Id:   "b1",
				Type: "paragraph",
				Text: "Hello, World!",
			}}},
		},
	})
	require.NoError(t, err)

	{
		gotLatest, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: doc.Account, Path: doc.Path})
		require.NoError(t, err)
		testutil.StructsEqual(gotLatest, doc3).Compare(t, "get without version must return latest doc")

		got3, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: doc.Account, Path: doc.Path, Version: doc3.Version})
		require.NoError(t, err)
		testutil.StructsEqual(got3, doc3).Compare(t, "get with version must return the correct doc")

		got2, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: doc.Account, Path: doc.Path, Version: doc2.Version})
		require.NoError(t, err)
		testutil.StructsEqual(got2, doc2).Compare(t, "get with version must return the correct doc")

		got1, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: doc.Account, Path: doc.Path, Version: doc.Version})
		require.NoError(t, err)
		testutil.StructsEqual(got1, doc).Compare(t, "get with version must return the correct doc")
	}
}

func TestConcurrentChanges(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	doc1, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice's profile"},
			}},
		},
	})
	require.NoError(t, err)

	doc21, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		BaseVersion:    doc1.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice from the Wonderland"},
			}},
		},
	})
	require.NoError(t, err)

	doc22, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		BaseVersion:    doc1.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice Pleasance Liddell"},
			}},
		},
	})
	require.NoError(t, err)

	concurrent, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{Account: doc1.Account, Path: doc1.Path})
	require.NoError(t, err)

	wantVersion := blob.NewVersion(
		must.Do2(cid.Decode(doc21.Version)),
		must.Do2(cid.Decode(doc22.Version)),
	)
	require.Equal(t, wantVersion.String(), concurrent.Version, "concurrent version must match")

	merged, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		BaseVersion:    concurrent.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice Pleasance Liddell. The one from the Wonderland."},
			}},
		},
	})
	require.NoError(t, err)
	require.False(t, strings.Contains(merged.Version, "."), "merged version must not be composite")
}

func TestCreateDocumentChangeWithTimestamp(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	now := time.Now().Add(24 * time.Hour * -1)

	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice from the Wonderland"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Hello",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b2", Parent: "b1", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b2",
					Type: "paragraph",
					Text: "World!",
				},
			}},
		},
		Timestamp: timestamppb.New(now),
	})
	require.NoError(t, err)

	want := &documents.Document{
		Account: alice.me.Account.PublicKey.String(),
		Path:    "",
		Metadata: must.Do2(structpb.NewStruct(map[string]any{
			"title": "Alice from the Wonderland",
		})),
		Authors: []string{alice.me.Account.PublicKey.String()},
		Content: []*documents.BlockNode{
			{
				Block: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Hello",
				},
				Children: []*documents.BlockNode{
					{
						Block: &documents.Block{
							Id:   "b2",
							Type: "paragraph",
							Text: "World!",
						},
					},
				},
			},
		},
		CreateTime: timestamppb.New(time.UnixMilli(0)),
		UpdateTime: timestamppb.New(now.Round(time.Millisecond)),
	}

	testutil.StructsEqual(want, doc).
		IgnoreFields(documents.Block{}, "Revision").
		IgnoreFields(documents.Document{}, "Version", "Genesis", "GenerationInfo").
		Compare(t, "profile document must match")

	doc, err = alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		BaseVersion:    doc.Version,
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Change with older timestamp must fail"},
			}},
		},
		Timestamp: timestamppb.New(now),
	})
	require.Error(t, err, "creating change with old timestamps must fail")
}

func TestTombstoneRef(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	home, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice's profile"},
			}},
		},
	})
	require.NoError(t, err)

	// Just in case testing that creating refs for home docs fails.
	{
		ref, err := alice.CreateRef(ctx, &documents.CreateRefRequest{
			Account:        home.Account,
			Path:           home.Path,
			SigningKeyName: "main",
			Target: &documents.RefTarget{
				Target: &documents.RefTarget_Tombstone_{
					Tombstone: &documents.RefTarget_Tombstone{},
				},
			},
		})
		_ = ref
		require.Error(t, err, "creating refs for home docs must fail")
	}

	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "/hello",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Hello World"},
			}},
		},
	})
	require.NoError(t, err)

	// Adding some sleep to make sure tomstone's timestamp is greater.
	time.Sleep(20 * time.Millisecond)

	tombstone, err := alice.CreateRef(ctx, &documents.CreateRefRequest{
		SigningKeyName: "main",
		Account:        doc.Account,
		Path:           doc.Path,
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Tombstone_{
				Tombstone: &documents.RefTarget_Tombstone{},
			},
		},
	})
	require.NoError(t, err)

	want := &documents.Ref{
		Id:      tombstone.Id,
		Account: "z6MkvFrq593SZ3QNsAgXdsHC2CJGrrwUdwxY2EdRGaT4UbYj",
		Path:    "/hello",
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Tombstone_{
				Tombstone: &documents.RefTarget_Tombstone{},
			},
		},
		Signer:         "z6MkvFrq593SZ3QNsAgXdsHC2CJGrrwUdwxY2EdRGaT4UbYj",
		Capability:     "",
		Timestamp:      tombstone.Timestamp,
		GenerationInfo: tombstone.GenerationInfo,
	}
	testutil.StructsEqual(want, tombstone).Compare(t, "tombstone ref must match")
	require.True(t, tombstone.Timestamp.AsTime().After(time.Now().Add(time.Hour*-1)), "ref timestamp must be set around the current time")

	// Now let's check the document disappears from the Get request.
	{
		got, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: tombstone.Account,
			Path:    tombstone.Path,
		})
		require.Error(t, err, "getting deleted document must fail")
		require.Nil(t, got)
	}

	// Getting previous versions should work though.
	{
		got, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: doc.Account,
			Path:    doc.Path,
			Version: doc.Version,
		})
		require.NoError(t, err)
		testutil.StructsEqual(doc, got).Compare(t, "getting doc with version must succeed even if deleted")
	}

	// We should be able to get the latest version prior to deletion.
	// TODO(burdiyan): implement this case when we've finalized the implementation of the trash can.
	// {
	// 	got, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
	// 		Account:       doc.Account,
	// 		Path:          doc.Path,
	// 		Version:       "",
	// 		IgnoreDeleted: true,
	// 	})
	// 	require.NoError(t, err, "ignore deleted should work in Get")
	// 	testutil.StructsEqual(doc, got).Compare(t, "getting doc with version must succeed even if deleted")
	// }

	// Deleted docs must disappear from the lists.
	{
		list, err := alice.ListDocuments(ctx, &documents.ListDocumentsRequest{
			Account:  alice.me.Account.PublicKey.String(),
			PageSize: 100,
		})
		require.NoError(t, err)
		require.Len(t, list.Documents, 1, "only initial root document must be in the list")

		testutil.StructsEqual(DocumentToListItem(home), list.Documents[0]).
			IgnoreFields(documents.DocumentInfo{}, "Breadcrumbs", "ActivitySummary").
			Compare(t, "listing must only show home document")
	}

	// But we also want to list the deleted docs.
	// TODO(burdiyan): implement this case when we've finalized the implementation of the trash can.
	// {
	// 	list, err := alice.ListDocuments(ctx, &documents.ListDocumentsRequest{
	// 		Account:     alice.me.Account.Principal().String(),
	// 		PageSize:    100,
	// 		DeletedOnly: true,
	// 	})
	// 	require.NoError(t, err)
	// 	require.Len(t, list.Documents, 1, "only the deleted document must be in the list")
	// 	testutil.StructsEqual(DocumentToListItem(doc), list.Documents[0]).Compare(t, "listing must only show home document")
	// }

	// Now I want to republish some document to the same path.
	republished, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "/hello",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Hello World Republished"},
			}},
		},
	})
	require.NoError(t, err, "publishing after deleting must work")

	// Check latest returns the latest.
	{
		got, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: republished.Account,
			Path:    republished.Path,
		})
		require.NoError(t, err)
		testutil.StructsEqual(republished, got).Compare(t, "getting latest must return the second generation")
	}

	// Check new generation works with latest.
	{
		got, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: republished.Account,
			Path:    republished.Path,
			Version: republished.Version,
		})
		require.NoError(t, err)
		testutil.StructsEqual(republished, got).Compare(t, "getting republished with version must work")
	}

	// Check get with version works for previous generation.
	{
		got, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: doc.Account,
			Path:    doc.Path,
			Version: doc.Version,
		})
		require.NoError(t, err)
		testutil.StructsEqual(doc, got).Compare(t, "getting republished with version must work")
	}

	// Check list contains latest.
	{
		list, err := alice.ListDocuments(ctx, &documents.ListDocumentsRequest{
			Account:  alice.me.Account.PublicKey.String(),
			PageSize: 100,
		})
		require.NoError(t, err)
		require.Len(t, list.Documents, 2, "list must contain the home doc and the second generation of the other doc")

		want := &documents.ListDocumentsResponse{
			Documents: []*documents.DocumentInfo{
				DocumentToListItem(home),
				DocumentToListItem(republished),
			},
		}

		slices.SortFunc(want.Documents, func(a, b *documents.DocumentInfo) int { return cmp.Compare(a.Version, b.Version) })
		slices.SortFunc(list.Documents, func(a, b *documents.DocumentInfo) int { return cmp.Compare(a.Version, b.Version) })

		testutil.StructsEqual(want, list).
			IgnoreFields(documents.DocumentInfo{}, "Breadcrumbs", "ActivitySummary").
			Compare(t, "listing must contain home doc and republished doc")
	}

	// Changes with no base version must fail when there's a live document.
	{
		_, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        alice.me.Account.PublicKey.String(),
			Path:           "/hello",
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Hello World Republished Must Fail"},
				}},
			},
		})
		require.Error(t, err, "changes with no base version must fail")
	}

	// Changes with base version of the old generation must not overwrite the newer generation
	{
		got, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        doc.Account,
			Path:           doc.Path,
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Hello World Revived Old Generation"},
				}},
			},
			BaseVersion: doc.Version,
		})
		require.NoError(t, err)

		gotv, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: got.Account,
			Path:    doc.Path,
			Version: got.Version,
		})
		require.NoError(t, err)
		testutil.StructsEqual(got, gotv).Compare(t, "getting version of the old generation must take into account new changes")

		gotLatest, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: doc.Account,
			Path:    doc.Path,
		})
		require.NoError(t, err)

		testutil.StructsEqual(republished, gotLatest).Compare(t, "changes with base version of the old generation must not overwrite the newer generation")
	}
}

func TestListDirectory(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	aliceSpace := alice.me.Account.PublicKey.String()

	_, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        aliceSpace,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "name", Value: "Alice's profile"},
			}},
		},
	})
	require.NoError(t, err)

	_, err = alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Path:           "/doc-1",
		Account:        aliceSpace,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "name", Value: "Doc1"},
			}},
		},
	})
	require.NoError(t, err)

	_, err = alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Path:           "/nested/doc-1",
		Account:        aliceSpace,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "name", Value: "Doc1"},
			}},
		},
	})
	require.NoError(t, err)

	require.NoError(t, err)

	doTest := func(dir string, sort *documents.SortOptions, recursive bool, want []string) {
		t.Helper()
		list, err := alice.ListDirectory(ctx, &documents.ListDirectoryRequest{
			Account:       aliceSpace,
			DirectoryPath: dir,
			SortOptions:   sort,
			Recursive:     recursive,
		})
		require.NoError(t, err)

		require.Len(t, list.Documents, len(want), "list must contain all wanted documents")

		for i, w := range list.Documents {
			require.Equal(t, want[i], w.Path, "list item %d doesn't match", i)
		}
	}

	doTest("", nil, false, []string{"/doc-1", ""})
	doTest("", nil, true, []string{"/nested/doc-1", "/doc-1", ""})

	doTest("",
		&documents.SortOptions{
			Attribute: documents.SortAttribute_ACTIVITY_TIME,
		},
		false,
		[]string{"", "/doc-1"},
	)
	doTest("",
		&documents.SortOptions{
			Attribute: documents.SortAttribute_ACTIVITY_TIME,
		},
		true,
		[]string{"", "/doc-1", "/nested/doc-1"},
	)

	doTest("/nested",
		&documents.SortOptions{
			Attribute: documents.SortAttribute_ACTIVITY_TIME,
		},
		false,
		[]string{"/nested/doc-1"},
	)
	doTest("/nested",
		&documents.SortOptions{
			Attribute: documents.SortAttribute_ACTIVITY_TIME,
		},
		true,
		[]string{"/nested/doc-1"},
	)
}

func TestUpdateReadStatus(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	bob := newTestDocsAPI(t, "bob")
	ctx := context.Background()

	// Create home document for Bob.
	bobHome, err := bob.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        bob.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob's profile"},
			}},
		},
	})
	require.NoError(t, err)

	// Create some nested documents for Bob.
	bobDoc1, err := bob.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        bob.me.Account.PublicKey.String(),
		Path:           "/doc-1",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob's Document 1"},
			}},
		},
	})
	require.NoError(t, err)

	bobDoc2, err := bob.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        bob.me.Account.PublicKey.String(),
		Path:           "/nested/doc-2",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob's Nested Document 2"},
			}},
		},
	})
	require.NoError(t, err)

	// Verify the documents were created correctly.
	require.NotNil(t, bobHome)
	require.NotNil(t, bobDoc1)
	require.NotNil(t, bobDoc2)

	// Sync bob into alice.
	syncStores(ctx, t, alice.idx, bob.idx)

	list, err := alice.ListDocuments(ctx, &documents.ListDocumentsRequest{Account: bob.me.Account.PublicKey.String(), PageSize: 1000})
	require.NoError(t, err)
	require.Len(t, list.Documents, 3, "alice must have all bob's docs")

	for _, x := range list.Documents {
		require.True(t, x.ActivitySummary.IsUnread, "all bob's docs must be unread")
	}

	_, err = alice.UpdateDocumentReadStatus(ctx, &documents.UpdateDocumentReadStatusRequest{
		Account: bobDoc1.Account,
		Path:    bobDoc1.Path,
		IsRead:  true,
	})
	require.NoError(t, err)

	list, err = alice.ListDocuments(ctx, &documents.ListDocumentsRequest{Account: bob.me.Account.PublicKey.String(), PageSize: 1000})
	require.NoError(t, err)

	for _, x := range list.Documents {
		if x.Account == bobDoc1.Account && x.Path == bobDoc1.Path {
			require.False(t, x.ActivitySummary.IsUnread, "bob's doc 1 must be read")
		} else {
			require.True(t, x.ActivitySummary.IsUnread, "other bob's docs must be unread")
		}
	}

	_, err = alice.UpdateDocumentReadStatus(ctx, &documents.UpdateDocumentReadStatusRequest{
		Account:     bobDoc1.Account,
		Path:        "",
		IsRead:      true,
		IsRecursive: true,
	})
	require.NoError(t, err)

	list, err = alice.ListDocuments(ctx, &documents.ListDocumentsRequest{Account: bob.me.Account.PublicKey.String(), PageSize: 1000})
	require.NoError(t, err)

	for _, x := range list.Documents {
		require.False(t, x.ActivitySummary.IsUnread, "all bob's docs must be unread")
	}
}

func TestDocumentAttributesFullJSONModel(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	want := map[string]any{
		"stringValue":    "Hello World",
		"intValue":       int64(42),
		"boolValue":      true,
		"boolValueFalse": false,
		"a": map[string]any{
			"b": map[string]any{
				"c": "Nested String",
			},
		},
	}

	doc, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), "", "", "main").
		SetAttribute("", []string{"stringValue"}, "Hello World").
		SetAttribute("", []string{"intValue"}, 42).
		SetAttribute("", []string{"boolValue"}, true).
		SetAttribute("", []string{"boolValueFalse"}, false).
		SetAttribute("", []string{"nullValue"}, nil).
		SetAttribute("", []string{"a", "b", "c"}, "Nested String").
		Build(),
	)
	require.NoError(t, err)
	testutil.StructsEqual(want, docmodel.ProtoStructAsMap(doc.Metadata)).Compare(t, "document attributes must match")

	accs, err := alice.ListAccounts(ctx, &documents.ListAccountsRequest{})
	require.NoError(t, err)
	testutil.StructsEqual(want, docmodel.ProtoStructAsMap(accs.Accounts[0].Metadata)).Compare(t, "document attributes must match")

	{
		doc, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), "", doc.Version, "main").
			SetAttribute("", []string{"stringValue"}, "ChangedString").
			SetAttribute("", []string{"intValue"}, 52).
			SetAttribute("", []string{"boolValueFalse"}, nil). // Make sure value is removed.
			SetAttribute("", []string{"nullValue"}, nil).
			SetAttribute("", []string{"a"}, nil).
			Build(),
		)
		require.NoError(t, err)
		want := map[string]any{
			"stringValue": "ChangedString",
			"intValue":    int64(52),
			"boolValue":   true,
		}
		testutil.StructsEqual(want, docmodel.ProtoStructAsMap(doc.Metadata)).Compare(t, "document attributes must match")
	}
}

func TestRedirect(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := t.Context()

	v1, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), "/src", "", "main").
		SetAttribute("", []string{"stringValue"}, "Hello World").
		SetAttribute("", []string{"intValue"}, 42).
		SetAttribute("", []string{"boolValue"}, true).
		SetAttribute("", []string{"boolValueFalse"}, false).
		SetAttribute("", []string{"nullValue"}, nil).
		SetAttribute("", []string{"a", "b", "c"}, "Nested String").
		Build(),
	)
	require.NoError(t, err)

	v2, err := alice.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice.me.Account.Principal(), v1.Path, v1.Version, "main").
		SetAttribute("", []string{"stringValue"}, "Changed string").
		Build(),
	)
	require.NoError(t, err)

	newRef, err := alice.CreateRef(ctx, &documents.CreateRefRequest{
		Account: v1.Account,
		Path:    "/fork",
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Version_{
				Version: &documents.RefTarget_Version{
					Genesis: v2.Genesis,
					Version: v2.Version,
				},
			},
		},
		SigningKeyName: "main",
	})
	require.NoError(t, err)
	_ = newRef

	fork, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: v2.Account,
		Path:    "/fork",
		Version: v2.Version,
	})
	require.NoError(t, err)

	testutil.StructsEqual(v2, fork).
		IgnoreFields(documents.GenerationInfo{}, "Generation").
		IgnoreFields(documents.Document{}, "Path").
		Compare(t, "fork must match the original document")

	// Now let's redirect /src to /fork.
	_, err = alice.CreateRef(ctx, &documents.CreateRefRequest{
		Account:        v2.Account,
		Path:           v2.Path,
		SigningKeyName: "main",
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Redirect_{
				Redirect: &documents.RefTarget_Redirect{
					Account: v2.Account,
					Path:    fork.Path,
				},
			},
		},
	})
	require.NoError(t, err)

	{
		_, err := alice.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: v2.Account,
			Path:    v2.Path,
		})
		require.Error(t, err)

		s, ok := status.FromError(err)
		require.True(t, ok, "error must be grpc status")
		details := s.Details()
		require.Len(t, details, 1, "redirect must have one detail object in the status error")
		redirectDetails := details[0].(*documents.RedirectErrorDetails)
		wantDetails := &documents.RedirectErrorDetails{
			TargetAccount: fork.Account,
			TargetPath:    fork.Path,
		}
		testutil.StructsEqual(wantDetails, redirectDetails).Compare(t, "redirect details must match")
	}
}

func TestUpdateProfile(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	profile := &documents.Profile{
		Name:        "Alice in Wonderland",
		Icon:        "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
		Description: "Down the rabbit hole!",
	}
	account, err := alice.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		Account:        alice.me.Account.PublicKey.String(),
		SigningKeyName: "main",
		Profile:        profile,
	})
	profile.UpdateTime = account.Profile.UpdateTime
	require.NoError(t, err)
	require.NotNil(t, account)

	testutil.StructsEqual(profile, account.Profile).Compare(t, "profiles must match")
}

type testServer struct {
	*Server
	me coretest.Tester
}

func newTestDocsAPI(t *testing.T, name string) testServer {
	u := coretest.NewTester(name)
	db := storage.MakeTestMemoryDB(t)
	ks := core.NewMemoryKeyStore()
	require.NoError(t, ks.StoreKey(context.Background(), "main", u.Account))
	idx := must.Do2(blob.OpenIndex(context.Background(), db, logging.New("seed/index"+"/"+name, "debug")))
	srv := NewServer(ks, idx, db, logging.New("seed/documents"+"/"+name, "debug"))
	return testServer{Server: srv, me: u}
}

func syncStores(ctx context.Context, t *testing.T, dst, src *blob.Index) {
	t.Helper()

	ctx = blob.ContextWithUnreadsTracking(ctx)

	cids, err := src.AllKeysChan(ctx)
	require.NoError(t, err)

	batch := make([]blocks.Block, 0, 50)

	var count int
	for c := range cids {
		if len(batch) == cap(batch) {
			err = dst.PutMany(ctx, batch)
			require.NoError(t, err)
			batch = batch[:0]
		}

		blk, err := src.Get(ctx, c)
		require.NoError(t, err)
		batch = append(batch, blk)
		count++
	}

	if len(batch) > 0 {
		err = dst.PutMany(ctx, batch)
		require.NoError(t, err)
	}

	require.Greater(t, count, 0)
}

func TestDetachedBlocks(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create a document with blocks that are not moved into the content tree.
	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "/detached-test",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Detached Blocks Test"},
			}},
			// Create blocks without moving them into the content tree.
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "detached1",
					Type: "paragraph",
					Text: "This block is detached",
				},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "detached2",
					Type: "paragraph",
					Text: "This block is also detached",
				},
			}},
			// Create one block that IS moved into the content tree for comparison.
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "content1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "content1",
					Type: "paragraph",
					Text: "This block is in the content tree",
				},
			}},
			// Create one more contant block that will be deleted later to make sure deletes are not considered detached.
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "content2", Parent: "", LeftSibling: "content1"},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "content2",
					Type: "paragraph",
					Text: "This will be deleted later",
				},
			}},
		},
	})
	require.NoError(t, err)
	_ = doc

	// Create a document with blocks that are not moved into the content tree.
	doc, err = alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		BaseVersion:    doc.Version,
		Path:           "/detached-test",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_DeleteBlock{
				DeleteBlock: "content2",
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "detached1.1", Parent: "detached1", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "detached1.1",
					Type: "paragraph",
					Text: "This is a child of an detached block.",
				},
			}},
		},
	})
	require.NoError(t, err)

	// The document should only contain blocks that were moved into the content tree.
	want := &documents.Document{
		Account: alice.me.Account.PublicKey.String(),
		Path:    "/detached-test",
		Metadata: must.Do2(structpb.NewStruct(map[string]any{
			"title": "Detached Blocks Test",
		})),
		Authors: []string{alice.me.Account.PublicKey.String()},
		Content: []*documents.BlockNode{
			{
				Block: &documents.Block{
					Id:   "content1",
					Type: "paragraph",
					Text: "This block is in the content tree",
				},
			},
		},
		DetachedBlocks: map[string]*documents.BlockNode{
			"detached1": &documents.BlockNode{
				Block: &documents.Block{
					Id:   "detached1",
					Type: "paragraph",
					Text: "This block is detached",
				},
				Children: []*documents.BlockNode{
					{
						Block: &documents.Block{
							Id:   "detached1.1",
							Type: "paragraph",
							Text: "This is a child of an detached block.",
						},
					},
				},
			},
			"detached2": &documents.BlockNode{
				Block: &documents.Block{
					Id:   "detached2",
					Type: "paragraph",
					Text: "This block is also detached",
				},
			},
		},
	}

	require.NotNil(t, doc.DetachedBlocks, "document must have detached blocks")

	testutil.StructsEqual(want, doc).
		IgnoreFields(documents.Block{}, "Revision").
		IgnoreFields(documents.Document{}, "CreateTime", "UpdateTime", "Version", "Genesis", "GenerationInfo").
		Compare(t, "document must contain detached blocks")

	// Verify that detached blocks are not in the content tree.
	require.Len(t, doc.Content, 1, "document should only have one block in content tree")
	require.Equal(t, "content1", doc.Content[0].Block.Id, "only the moved block should be in content")

	// Create another change that moves one of the detached blocks into the tree.
	doc2, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "/detached-test",
		BaseVersion:    doc.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "detached1", Parent: "content1", LeftSibling: ""},
			}},
		},
	})
	require.NoError(t, err)

	// Now the document should have the previously detached block.
	require.Len(t, doc2.Content, 1, "document should still have one root block")
	require.Len(t, doc2.Content[0].Children, 1, "root block should now have one child")
	require.Equal(t, "detached1", doc2.Content[0].Children[0].Block.Id, "detached block should now be in content tree")
	require.Equal(t, "This block is detached", doc2.Content[0].Children[0].Block.Text, "detached block text should be preserved")
}

func TestBug_DetachedBlocksWithChildrenInTheSameChange(t *testing.T) {
	// We had a bug when a detached block was created along with its children in the same change.
	// It's because when we clean up and prepare the change we put move operations before replace operations,
	// which resulted in moves refering to parents that were never mentioned before.
	// We fixed this by just allowing this to happen.

	t.Parallel()

	ctx := t.Context()
	alice := newTestDocsAPI(t, "alice")

	// 1. Create home document with content blocks and a detached navigation block.
	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Home"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Welcome!",
				},
			}},
			// {Op: &documents.DocumentChange_ReplaceBlock{
			// 	ReplaceBlock: &documents.Block{
			// 		Id:   "navigation",
			// 		Type: "navigation",
			// 	},
			// }},
		},
	})
	require.NoError(t, err)

	// 2. Add navigation items as children of the navigation block in a separate change.
	doc, err = alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		BaseVersion:    doc.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "navigation",
					Type: "navigation",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "nav1", Parent: "navigation", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "nav1",
					Type: "navigation_item",
					Text: "First",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "nav2", Parent: "navigation", LeftSibling: "nav1"},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "nav2",
					Type: "navigation_item",
					Text: "Second",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "nav3", Parent: "navigation", LeftSibling: "nav2"},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "nav3",
					Type: "navigation_item",
					Text: "Third",
				},
			}},
		},
	})
	require.NoError(t, err)

	// 3. Move navigation items around and check the order.
	doc, err = alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.PublicKey.String(),
		Path:           "",
		BaseVersion:    doc.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "navigation",
					Type: "navigation",
				},
			}},
			// Move nav3 to the front (before nav1)
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "nav3", Parent: "navigation", LeftSibling: ""},
			}},
			// Move nav1 after nav2 (so order: nav3, nav2, nav1)
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "nav1", Parent: "navigation", LeftSibling: "nav2"},
			}},
		},
	})
	require.NoError(t, err)

	nav := doc.DetachedBlocks["navigation"]
	require.NotNil(t, nav, "navigation block must exist")
	require.Len(t, nav.Children, 3, "navigation must have 3 children")
	require.Equal(t, "nav3", nav.Children[0].Block.Id, "first nav item must be nav3")
	require.Equal(t, "nav2", nav.Children[1].Block.Id, "second nav item must be nav2")
	require.Equal(t, "nav1", nav.Children[2].Block.Id, "third nav item must be nav1")
}
