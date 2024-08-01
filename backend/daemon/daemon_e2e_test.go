package daemon

import (
	"context"
	documentsimpl "seed/backend/api/documents/v3alpha"
	"seed/backend/core"
	"seed/backend/core/coretest"
	daemon "seed/backend/genproto/daemon/v1alpha"
	documents "seed/backend/genproto/documents/v3alpha"
	networking "seed/backend/genproto/networking/v1alpha"
	"seed/backend/mttnet"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func TestDaemonRegisterKey(t *testing.T) {
	t.Parallel()

	dmn := makeTestApp(t, "alice", makeTestConfig(t), false)
	ctx := context.Background()

	conn, err := grpc.Dial(dmn.GRPCListener.Addr().String(), grpc.WithBlock(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	defer conn.Close()

	dc := daemon.NewDaemonClient(conn)

	seed, err := dc.GenMnemonic(ctx, &daemon.GenMnemonicRequest{})
	require.NoError(t, err)

	reg, err := dc.RegisterKey(ctx, &daemon.RegisterKeyRequest{
		Name:     "main",
		Mnemonic: seed.Mnemonic,
	})
	require.NoError(t, err)
	require.NotNil(t, reg)
	require.NotEqual(t, "", reg.PublicKey, "account ID must be generated after registration")

	_, err = core.DecodePrincipal(reg.PublicKey)
	require.NoError(t, err, "account must have principal encoding")

	me := must.Do2(dmn.Storage.KeyStore().GetKey(ctx, "main"))
	require.Equal(t, me.String(), reg.PublicKey)

	keys, err := dc.ListKeys(ctx, &daemon.ListKeysRequest{})
	require.NoError(t, err)
	require.Len(t, keys.Keys, 1, "there must only be one key")

	{
		seed, err := dc.GenMnemonic(ctx, &daemon.GenMnemonicRequest{})
		require.NoError(t, err)

		reg, err := dc.RegisterKey(ctx, &daemon.RegisterKeyRequest{
			Name:     "secondary",
			Mnemonic: seed.Mnemonic,
		})
		require.NoError(t, err)
		require.NotNil(t, reg)
		require.NotEqual(t, "", reg.PublicKey, "account ID must be generated after registration")

		keys, err := dc.ListKeys(ctx, &daemon.ListKeysRequest{})
		require.NoError(t, err)
		require.Len(t, keys.Keys, 2, "there must only be two keys after registering second key")
	}
}

func TestDaemonUpdateProfile(t *testing.T) {
	t.Parallel()

	dmn := makeTestApp(t, "alice", makeTestConfig(t), true)
	ctx := context.Background()
	alice := coretest.NewTester("alice")

	doc, err := dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account: alice.Account.Principal().String(),
		Path:    "",
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
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	want := &documents.Document{
		Account: alice.Account.Principal().String(),
		Path:    "",
		Metadata: map[string]string{
			"title": "Alice from the Wonderland",
		},
		Authors: []string{alice.Account.Principal().String()},
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

	// Do another update.
	{
		doc, err := dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
			Account: alice.Account.Principal().String(),
			Path:    "",
			Changes: []*documents.DocumentChange{
				{Op: &documents.DocumentChange_SetMetadata_{
					SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Just Alice"},
				}},
			},
			SigningKeyName: "main",
		})
		require.NoError(t, err)

		want := &documents.Document{
			Account: alice.Account.Principal().String(),
			Path:    "",
			Metadata: map[string]string{
				"title": "Just Alice",
			},
			Authors: []string{alice.Account.Principal().String()},
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
}

func TestSyncingProfiles(t *testing.T) {
	t.Parallel()
	t.Skip()
	alice := makeTestApp(t, "alice", makeTestConfig(t), true)
	ctx := context.Background()
	aliceIdentity := coretest.NewTester("alice")
	bob := makeTestApp(t, "bob", makeTestConfig(t), true)
	bobIdentity := coretest.NewTester("bob")
	doc, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.Principal().String(),
		Path:           "",
		SigningKeyName: "main",
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

	_, err = alice.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: mttnet.AddrInfoToStrings(bob.Net.AddrInfo()),
	})
	require.NoError(t, err)

	// _, err = bob.RPC.DocumentsV3.GetProfileDocument(ctx, &documents.GetProfileDocumentRequest{
	//	AccountId: aliceIdentity.Account.Principal().String(),
	// })
	// require.Error(t, err)
	// Since bob implements a syncback policy triggered when Alice connected to him, we don't need
	// to force any syncing just wait for bob to instantly syncs content right after connection.
	//_, err = bob.RPC.Daemon.ForceSync(ctx, &daemon.ForceSyncRequest{})
	//require.NoError(t, err)
	time.Sleep(time.Millisecond * 200)
	doc2, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceIdentity.Account.Principal().String(),
		Path:    "",
	})
	require.NoError(t, err)
	require.Equal(t, doc.Content, doc2.Content)

	bobsProfile, err := bob.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        bobIdentity.Account.Principal().String(),
		Path:           "",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob's land"},
			}},
		},
	})
	require.NoError(t, err)
	docs, err := bob.RPC.DocumentsV3.ListRootDocuments(ctx, &documents.ListRootDocumentsRequest{})
	require.NoError(t, err)
	require.Len(t, docs.Documents, 2)
	docs, err = bob.RPC.DocumentsV3.ListRootDocuments(ctx, &documents.ListRootDocumentsRequest{
		PageSize:  1,
		PageToken: "",
	})
	require.NoError(t, err)
	require.Len(t, docs.Documents, 1)
	testutil.StructsEqual(documentsimpl.DocumentToListItem(bobsProfile), docs.Documents[0]).Compare(t, "list item must match")
	docs, err = bob.RPC.DocumentsV3.ListRootDocuments(ctx, &documents.ListRootDocumentsRequest{
		PageSize:  1,
		PageToken: docs.NextPageToken,
	})
	require.NoError(t, err)
	require.Len(t, docs.Documents, 1)
	require.Equal(t, documentsimpl.DocumentToListItem(doc), docs.Documents[0])
}
