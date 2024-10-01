package documents

import (
	"context"
	"seed/backend/core"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/index"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"strings"
	"testing"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
)

func TestCreateDocumentChange(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
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
		Account: alice.me.Account.Principal().String(),
		Path:    "",
		Metadata: map[string]string{
			"title": "Alice from the Wonderland",
		},
		Authors: []string{alice.me.Account.Principal().String()},
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
		IgnoreFields(documents.Document{}, "CreateTime", "UpdateTime", "Version").
		Compare(t, "profile document must match")
}

func TestListRootDocuments(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create root document for Alice.
	profile, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
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
		Account:        alice.me.Account.Principal().String(),
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
	var bobsRoot *documents.DocumentListItem
	{
		bob := newTestDocsAPI(t, "bob")
		_, err = bob.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			SigningKeyName: "main",
			Account:        bob.me.Account.Principal().String(),
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
	testutil.StructsEqual(bobsRoot, roots.Documents[0]).Compare(t, "bobs root document must match and be first")
	testutil.StructsEqual(wantAlicesRoot, roots.Documents[1]).Compare(t, "alice's root document must match and be second")
}

func TestListDocument(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	profile, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
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
		Account:        alice.me.Account.Principal().String(),
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
		Account:        alice.me.Account.Principal().String(),
		Path:           "/named/bar",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Named document 2"},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, namedDoc2)

	list, err := alice.ListDocuments(ctx, &documents.ListDocumentsRequest{Account: alice.me.Account.Principal().String()})
	require.NoError(t, err)

	want := []*documents.DocumentListItem{DocumentToListItem(namedDoc2), DocumentToListItem(namedDoc), DocumentToListItem(profile)}
	require.Len(t, list.Documents, len(want))

	testutil.StructsEqual(want[0], list.Documents[0]).Compare(t, "named2 must be the first doc in the list")
	testutil.StructsEqual(want[1], list.Documents[1]).Compare(t, "named must be the second doc in the list")
	testutil.StructsEqual(want[2], list.Documents[2]).Compare(t, "profile doc must be the last element in the list")
}

func TestGetDocumentWithVersion(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
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
		Account:        alice.me.Account.Principal().String(),
		Path:           "",
		BaseVersion:    doc.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_DeleteBlock{DeleteBlock: "b2"}},
		},
	})
	require.NoError(t, err)

	doc3, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
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
		Account:        alice.me.Account.Principal().String(),
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
		Account:        alice.me.Account.Principal().String(),
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
		Account:        alice.me.Account.Principal().String(),
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

	wantVersion := index.NewVersion(
		must.Do2(cid.Decode(doc21.Version)),
		must.Do2(cid.Decode(doc22.Version)),
	)
	require.Equal(t, wantVersion.String(), concurrent.Version, "concurrent version must match")

	merged, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.me.Account.Principal().String(),
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

type testServer struct {
	*Server
	me coretest.Tester
}

func newTestDocsAPI(t *testing.T, name string) testServer {
	u := coretest.NewTester(name)
	db := storage.MakeTestMemoryDB(t)
	ks := core.NewMemoryKeyStore()
	require.NoError(t, ks.StoreKey(context.Background(), "main", u.Account))
	idx := index.NewIndex(db, logging.New("seed/index"+"/"+name, "debug"), nil)
	srv := NewServer(ks, idx, db, logging.New("seed/documents"+"/"+name, "debug"))
	return testServer{Server: srv, me: u}
}
