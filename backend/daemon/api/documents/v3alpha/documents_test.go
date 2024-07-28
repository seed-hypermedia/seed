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

type testServer struct {
	*Server
	me coretest.Tester
}

func newTestDocsAPI(t *testing.T, name string) testServer {
	u := coretest.NewTester("alice")

	db := storage.MakeTestMemoryDB(t)
	ks := core.NewMemoryKeyStore()
	require.NoError(t, ks.StoreKey(context.Background(), "main", u.Account))
	idx := index.NewIndex(db, logging.New("seed/index", "debug"))
	srv := NewServer(ks, idx, db)
	return testServer{Server: srv, me: u}
}
