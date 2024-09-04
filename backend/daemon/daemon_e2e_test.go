package daemon

import (
	"context"
	documentsimpl "seed/backend/api/documents/v3alpha"
	"seed/backend/core"
	"seed/backend/core/coretest"
	activity "seed/backend/genproto/activity/v1alpha"
	daemon "seed/backend/genproto/daemon/v1alpha"
	documents "seed/backend/genproto/documents/v3alpha"
	entities "seed/backend/genproto/entities/v1alpha"
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
			Account:     alice.Account.Principal().String(),
			Path:        "",
			BaseVersion: doc.Version,
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
	_, err = bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: mttnet.AddrInfoToStrings(alice.Net.AddrInfo()),
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
	time.Sleep(time.Millisecond * 500)
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

func TestSyncingEntity(t *testing.T) {
	t.Parallel()
	t.Skip("Under construction")
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

	doc2, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.Principal().String(),
		Path:           "/new-doc",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Regular Doc"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Not an awesome",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b2", Parent: "b1", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b2",
					Type: "paragraph",
					Text: "Quote anyways",
				},
			}},
		},
	})
	require.NoError(t, err)
	_, err = bob.RPC.Entities.DiscoverEntity(ctx, &entities.DiscoverEntityRequest{
		Id: "hm://" + doc2.Account + doc2.Path,
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
	time.Sleep(time.Millisecond * 300)
	docGotten, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceIdentity.Account.Principal().String(),
		Path:    "",
	})
	require.NoError(t, err)
	require.Equal(t, doc.Content, docGotten.Content)
	doc2Gotten, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceIdentity.Account.Principal().String(),
		Path:    "/new-doc",
	})
	require.NoError(t, err)
	require.Equal(t, doc2.Content, doc2Gotten.Content)

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
		PageSize:  2,
		PageToken: docs.NextPageToken,
	})
	require.NoError(t, err)
	require.Len(t, docs.Documents, 1)
	require.Equal(t, documentsimpl.DocumentToListItem(doc), docs.Documents[0])
}

func TestSubscriptions(t *testing.T) {
	t.Parallel()
	aliceCfg := makeTestConfig(t)
	aliceCfg.Syncing.NoSyncBack = true
	aliceCfg.Syncing.SmartSyncing = true
	aliceCfg.Syncing.Interval = time.Millisecond * 20
	aliceCfg.Syncing.WarmupDuration = time.Millisecond * 50
	//aliceCfg.Syncing.NoPull = true
	alice := makeTestApp(t, "alice", aliceCfg, true)
	ctx := context.Background()
	aliceIdentity := coretest.NewTester("alice")
	bobCfg := makeTestConfig(t)
	bobCfg.Syncing.NoSyncBack = true
	bobCfg.Syncing.SmartSyncing = true
	bobCfg.Syncing.Interval = time.Millisecond * 20
	bobCfg.Syncing.WarmupDuration = time.Millisecond * 50
	//bobCfg.Syncing.NoPull = true
	bob := makeTestApp(t, "bob", bobCfg, true)
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
	doc2, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.Principal().String(),
		Path:           "/cars/toyota",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Why Toyota rocks"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Because it sounds great",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b2", Parent: "b1", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b2",
					Type: "paragraph",
					Text: "Quote anyways",
				},
			}},
		},
	})
	require.NoError(t, err)

	doc3, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.Principal().String(),
		Path:           "/cars/honda",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Why Honda rocks"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Because it sounds great",
				},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b2", Parent: "b1", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b2",
					Type: "paragraph",
					Text: "Quote anyways 2",
				},
			}},
		},
	})
	require.NoError(t, err)
	doc4, err := bob.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        bobIdentity.Account.Principal().String(),
		Path:           "",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob not from the Wonderland"},
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
	_, err = bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: mttnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)

	time.Sleep(time.Millisecond * 120)
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc2.Account,
		Path:    doc2.Path,
	})
	require.Error(t, err)

	// Force sync will sync subscribed content. Since there is no subscriptions,
	// no content is expected to be synced
	_, err = bob.RPC.Daemon.ForceSync(ctx, &daemon.ForceSyncRequest{})
	require.NoError(t, err)

	time.Sleep(time.Millisecond * 120)
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc2.Account,
		Path:    doc2.Path,
	})
	require.Error(t, err)

	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   doc2.Account,
		Path:      doc2.Path,
		Recursive: false,
	})
	require.NoError(t, err)

	res, err := bob.RPC.Activity.ListSubscriptions(ctx, &activity.ListSubscriptionsRequest{})
	require.NoError(t, err)
	require.Len(t, res.Subscriptions, 1)
	require.Equal(t, doc2.Account, res.Subscriptions[0].Account)
	require.Equal(t, doc2.Path, res.Subscriptions[0].Path)
	time.Sleep(time.Millisecond * 120)

	_, err = alice.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc4.Account,
		Path:    doc4.Path,
	})
	require.Error(t, err)

	doc2Gotten, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc2.Account,
		Path:    doc2.Path,
	})
	require.NoError(t, err)
	require.Equal(t, doc2.Content, doc2Gotten.Content)

	// We should not sync this document since we did not subscribe recursively.
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc3.Account,
		Path:    doc3.Path,
	})
	require.Error(t, err)

	_, err = bob.RPC.Activity.Unsubscribe(ctx, &activity.UnsubscribeRequest{
		Account: doc2.Account,
		Path:    doc2.Path,
	})
	require.NoError(t, err)
	res, err = bob.RPC.Activity.ListSubscriptions(ctx, &activity.ListSubscriptionsRequest{})
	require.NoError(t, err)
	require.Len(t, res.Subscriptions, 0)

	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   doc3.Account,
		Path:      "/cars",
		Recursive: true,
	})
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 120)

	doc3Gotten, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc3.Account,
		Path:    doc3.Path,
	})
	require.NoError(t, err)
	require.Equal(t, doc3.Content, doc3Gotten.Content)

	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc.Account,
		Path:    doc.Path,
	})
	require.Error(t, err)

	doc3Modified, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.Principal().String(),
		BaseVersion:    doc3.Version,
		Path:           "/cars/honda",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			//{Op: &documents.DocumentChange_MoveBlock_{
			//	MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			//}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Modified Content",
				},
			}},
		},
	})
	require.NoError(t, err)
	require.NotEqual(t, doc3.Version, doc3Modified.Version)
	require.Equal(t, doc3.Version, doc3Modified.PreviousVersion)

	// TODO(juligasa): instead of forcing a subscription, we already have a recursive
	// subscription on a top level path so we just wait for the periodic subscription.

	//newCtx, cancel := context.WithTimeout(ctx, time.Minute*10)
	//defer cancel()
	/*
		_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
			Account:   doc3.Account,
			Path:      "/cars/honda",
			Recursive: false,
		})
		require.NoError(t, err)

	*/
	doc3Gotten, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc3Modified.Account,
		Path:    doc3Modified.Path,
	})
	require.NoError(t, err)
	require.NotEqual(t, doc3Gotten.Version, doc3Modified.Version)

	time.Sleep(time.Millisecond * 120)
	doc3Gotten, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc3Modified.Account,
		Path:    doc3Modified.Path,
	})
	require.NoError(t, err)
	require.Equal(t, doc3Gotten.Version, doc3Modified.Version)
	require.Equal(t, doc3Modified.Content, doc3Gotten.Content)
}
