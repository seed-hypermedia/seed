package documents

import (
	"context"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/daemon/index"
	storage "seed/backend/daemon/storage2"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/logging"
	"seed/backend/testutil"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCreateDocumentChange(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	doc, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Namespace:      alice.me.Account.Principal().String(),
		Path:           "/",
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
		Namespace: alice.me.Account.Principal().String(),
		Path:      "/",
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
		IgnoreFields(documents.Document{}, "CreateTime", "UpdateTime", "Version", "PreviousVersion").
		Compare(t, "profile document must match")
}

func TestListRootDocuments(t *testing.T) {
	t.Parallel()

	alice := newTestDocsAPI(t, "alice")
	ctx := context.Background()

	// Create root document for Alice.
	profile, err := alice.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Namespace:      alice.me.Account.Principal().String(),
		Path:           "/",
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
		Namespace:      alice.me.Account.Principal().String(),
		Path:           "/named",
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
			Namespace:      bob.me.Account.Principal().String(),
			Path:           "/",
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

	wantAlicesRoot := &documents.DocumentListItem{
		Namespace:  alice.me.Account.Principal().String(),
		Path:       "/",
		Title:      "Alice's profile",
		Authors:    []string{alice.me.Account.Principal().String()},
		CreateTime: profile.CreateTime,
		UpdateTime: profile.UpdateTime,
		Version:    profile.Version,
	}
	testutil.StructsEqual(bobsRoot, roots.Documents[0]).Compare(t, "bobs root document must match and be first")
	testutil.StructsEqual(wantAlicesRoot, roots.Documents[1]).Compare(t, "alice's root document must match and be second")
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
	idx := index.NewIndex(db, logging.New("seed/index"+"/"+name, "debug"))
	srv := NewServer(ks, idx, db)
	return testServer{Server: srv, me: u}
}
