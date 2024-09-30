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
		IgnoreFields(documents.Document{}, "CreateTime", "UpdateTime", "Version").
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
			IgnoreFields(documents.Document{}, "CreateTime", "UpdateTime", "Version").
			Compare(t, "profile document must match")
	}
}

func TestConnectivity(t *testing.T) {
	t.Parallel()
	aliceCfg := makeTestConfig(t)
	aliceCfg.Syncing.NoSyncBack = true
	aliceCfg.Syncing.SmartSyncing = true
	aliceCfg.Syncing.Interval = time.Millisecond * 100
	aliceCfg.Syncing.WarmupDuration = time.Millisecond * 200
	aliceCfg.Syncing.NoPull = true
	aliceCfg.LogLevel = "debug"
	alice := makeTestApp(t, "alice", aliceCfg, true)
	ctx := context.Background()

	bobCfg := makeTestConfig(t)
	bobCfg.Syncing.NoSyncBack = true
	bobCfg.Syncing.SmartSyncing = true
	bobCfg.Syncing.Interval = time.Millisecond * 100
	bobCfg.Syncing.WarmupDuration = time.Millisecond * 200
	bobCfg.Syncing.NoPull = true
	bobCfg.LogLevel = "debug"
	bob := makeTestApp(t, "bob", bobCfg, true)

	_, err := bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: mttnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 200)
	res, err := bob.RPC.Networking.ListPeers(ctx, &networking.ListPeersRequest{
		PageSize: 10,
	})
	require.NoError(t, err)
	require.Len(t, res.Peers, 1)
	res, err = alice.RPC.Networking.ListPeers(ctx, &networking.ListPeersRequest{
		PageSize: 10,
	})
	require.NoError(t, err)
	require.Len(t, res.Peers, 1, "Alice should also have Bob as a peer")
}
func TestSyncingProfiles(t *testing.T) {
	t.Skip("Dumb Syncing not supported")
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

func TestDiscoverHomeDocument(t *testing.T) {
	t.Parallel()
	aliceCfg := makeTestConfig(t)
	aliceCfg.Syncing.NoSyncBack = true
	aliceCfg.Syncing.SmartSyncing = true
	aliceCfg.LogLevel = "debug"
	alice := makeTestApp(t, "alice", aliceCfg, false)
	ctx := context.Background()
	bobCfg := makeTestConfig(t)
	bobCfg.Syncing.NoSyncBack = true
	bobCfg.Syncing.SmartSyncing = true
	bobCfg.LogLevel = "debug"
	bob := makeTestApp(t, "bob", bobCfg, true)

	ret, err := alice.RPC.Daemon.RegisterKey(ctx, &daemon.RegisterKeyRequest{
		Mnemonic: []string{"dinner", "fruit", "sleep", "olive", "unfair", "sight", "velvet", "endorse", "example", "key", "okay", "meadow"},
		Name:     "main",
	})
	require.NoError(t, err)
	homeDoc, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        ret.AccountId,
		Path:           "",
		SigningKeyName: ret.Name,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Welcome to Alice's account",
				},
			}},
		},
	})
	require.NoError(t, err)
	_, err = bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: mttnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)

	_, err = bob.RPC.Entities.DiscoverEntity(ctx, &entities.DiscoverEntityRequest{
		Account: homeDoc.Account,
	})
	require.NoError(t, err)

	accGotten, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: homeDoc.Account,
		Path:    "",
	})
	require.NoError(t, err)
	require.Equal(t, homeDoc.Version, accGotten.Version)
	require.Equal(t, homeDoc.Content, accGotten.Content)
}

func TestSubscriptions(t *testing.T) {
	t.Parallel()
	aliceCfg := makeTestConfig(t)
	aliceCfg.Syncing.NoSyncBack = true
	aliceCfg.Syncing.SmartSyncing = true
	aliceCfg.Syncing.RefreshInterval = time.Millisecond * 150
	aliceCfg.Syncing.Interval = time.Millisecond * 100
	aliceCfg.Syncing.WarmupDuration = time.Millisecond * 200
	//aliceCfg.Syncing.NoPull = true
	aliceCfg.LogLevel = "debug"
	alice := makeTestApp(t, "alice", aliceCfg, true)
	ctx := context.Background()
	aliceIdentity := coretest.NewTester("alice")
	bobCfg := makeTestConfig(t)
	bobCfg.Syncing.NoSyncBack = true
	bobCfg.Syncing.SmartSyncing = true
	bobCfg.Syncing.Interval = time.Millisecond * 100
	bobCfg.Syncing.WarmupDuration = time.Millisecond * 200
	//bobCfg.Syncing.NoPull = true
	bobCfg.LogLevel = "debug"
	bob := makeTestApp(t, "bob", bobCfg, true)
	bobIdentity := coretest.NewTester("bob")
	carolCfg := makeTestConfig(t)
	carolCfg.Syncing.NoSyncBack = true
	carolCfg.Syncing.SmartSyncing = true
	carolCfg.Syncing.Interval = time.Millisecond * 100
	carolCfg.Syncing.WarmupDuration = time.Millisecond * 200
	//carolCfg.Syncing.NoPull = true
	carolCfg.LogLevel = "debug"
	carol := makeTestApp(t, "carol", carolCfg, true)
	carolIdentity := coretest.NewTester("carol")
	carolHome, err := carol.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        carolIdentity.Account.Principal().String(),
		Path:           "",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "This is me"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Carol",
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
	ret, err := alice.RPC.Daemon.RegisterKey(ctx, &daemon.RegisterKeyRequest{
		Mnemonic: []string{"dinner", "fruit", "sleep", "olive", "unfair", "sight", "velvet", "endorse", "example", "key", "okay", "meadow"},
		Name:     "secondary",
	})
	require.NoError(t, err)
	dummyAcc, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        ret.AccountId,
		Path:           "",
		SigningKeyName: ret.Name,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Hidden Account"},
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

	time.Sleep(time.Millisecond * 100)
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc2.Account,
		Path:    doc2.Path,
	})
	require.Error(t, err)

	// Force sync will sync subscribed content. Since there is no subscriptions,
	// no content is expected to be synced
	_, err = bob.RPC.Daemon.ForceSync(ctx, &daemon.ForceSyncRequest{})
	require.NoError(t, err)

	time.Sleep(time.Millisecond * 100)
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
	time.Sleep(time.Millisecond * 100)

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

	// we have 2 subscriptions to force the multiple subscriptions error
	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   doc3.Account,
		Path:      "/non/existing/path",
		Recursive: false,
	})
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 100)
	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   doc3.Account,
		Path:      "/cars",
		Recursive: true,
	})
	bob.log.Debug("Just subscribed")
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 100)

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
	require.NoError(t, err)

	doc3Modified, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.Principal().String(),
		BaseVersion:    doc3.Version,
		Path:           "/cars/honda",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
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

	require.Eventually(t, func() bool {
		doc3Gotten, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: doc3Modified.Account,
			Path:    doc3Modified.Path,
		})
		require.NoError(t, err)
		return doc3Gotten.Version == doc3Modified.Version
	}, time.Second*5, time.Millisecond*200, "We should get the modified version, not the previous one")

	require.Equal(t, doc3Modified.Content, doc3Gotten.Content)

	bobComment, err := bob.RPC.DocumentsV3.CreateComment(ctx, &documents.CreateCommentRequest{
		TargetAccount: doc3Modified.Account,
		TargetPath:    doc3Modified.Path,
		TargetVersion: doc3Modified.Version,
		Content: []*documents.BlockNode{
			{
				Block: &documents.Block{Id: "b1", Type: "paragraph", Text: "Hello, Alice!"},
				Children: []*documents.BlockNode{
					{Block: &documents.Block{Id: "b2", Type: "paragraph", Text: "How are you?"}},
				},
			},
		},
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	comments, err := alice.RPC.DocumentsV3.ListComments(ctx, &documents.ListCommentsRequest{
		TargetAccount: doc3Modified.Account,
		TargetPath:    doc3Modified.Path,
	})
	require.NoError(t, err)
	require.Len(t, comments.Comments, 0)
	_, err = alice.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   doc3Modified.Account,
		Path:      doc3Modified.Path,
		Recursive: false,
	})
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 200)
	comments, err = alice.RPC.DocumentsV3.ListComments(ctx, &documents.ListCommentsRequest{
		TargetAccount: doc3Modified.Account,
		TargetPath:    doc3Modified.Path,
	})
	require.NoError(t, err)
	require.Len(t, comments.Comments, 1)
	require.Equal(t, bobComment.Content, comments.Comments[0].Content)

	reply, err := alice.RPC.DocumentsV3.CreateComment(ctx, &documents.CreateCommentRequest{
		TargetAccount:  doc3Modified.Account,
		TargetPath:     doc3Modified.Path,
		TargetVersion:  doc3Modified.Version,
		ReplyParent:    bobComment.Id,
		Content:        []*documents.BlockNode{{Block: &documents.Block{Id: "b1", Type: "paragraph", Text: "Hello back, Bob!"}, Children: []*documents.BlockNode{{Block: &documents.Block{Id: "b2", Type: "paragraph", Text: "Love your comment"}}}}},
		SigningKeyName: "main",
		Capability:     "",
	})
	require.NoError(t, err)

	cpb, err := alice.RPC.DocumentsV3.CreateCapability(ctx, &documents.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       bobIdentity.Account.String(),
		Account:        aliceIdentity.Account.Principal().String(),
		Path:           doc3.Path,
		Role:           documents.Role_WRITER,
	})
	require.NoError(t, err)
	require.NotNil(t, cpb)
	list, err := alice.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
		Account: aliceIdentity.Account.Principal().String(),
		Path:    doc3.Path,
	})
	require.NoError(t, err)
	require.Len(t, list.Capabilities, 1, "must return the capability")

	require.Eventually(t, func() bool {
		comments, err = bob.RPC.DocumentsV3.ListComments(ctx, &documents.ListCommentsRequest{
			TargetAccount: doc3Modified.Account,
			TargetPath:    doc3Modified.Path,
		})
		require.NoError(t, err)
		return len(comments.Comments) == 2
	}, time.Second*5, time.Millisecond*200, "We should have two comments, the initial comment and the reply")
	require.Equal(t, reply.Content, comments.Comments[1].Content)

	bobsCap, err := bob.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
		Account: aliceIdentity.Account.Principal().String(),
		Path:    doc3.Path,
	})
	require.NoError(t, err)
	require.Len(t, bobsCap.Capabilities, 1, "must return the capability")

	_, err = carol.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: mttnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)

	entity, err := carol.RPC.Entities.DiscoverEntity(ctx, &entities.DiscoverEntityRequest{
		Account: doc3Modified.Account,
		Path:    doc3Modified.Path,
	})
	require.NoError(t, err)
	require.Equal(t, doc3Modified.Version, entity.Version)

	carolRoots, err := carol.RPC.DocumentsV3.ListRootDocuments(ctx, &documents.ListRootDocumentsRequest{})
	require.NoError(t, err)
	require.Len(t, carolRoots.Documents, 3, "Carol must have Alice's & Bob's root document and her own")

	carolComment, err := carol.RPC.DocumentsV3.CreateComment(ctx, &documents.CreateCommentRequest{
		TargetAccount: doc3Modified.Account,
		TargetPath:    doc3Modified.Path,
		TargetVersion: entity.Version,
		Content: []*documents.BlockNode{
			{
				Block: &documents.Block{Id: "b1", Type: "paragraph", Text: "I'm carol!"},
				Children: []*documents.BlockNode{
					{Block: &documents.Block{Id: "b2", Type: "paragraph", Text: "Hope you're well"}},
				},
			},
		},
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		_, err = alice.RPC.DocumentsV3.GetComment(ctx, &documents.GetCommentRequest{
			Id: carolComment.Id,
		})
		return err == nil
	}, time.Second*1, time.Millisecond*100, "Alice should get Carol's comment")

	require.Eventually(t, func() bool {
		comments, err = bob.RPC.DocumentsV3.ListComments(ctx, &documents.ListCommentsRequest{
			TargetAccount: doc3Modified.Account,
			TargetPath:    doc3Modified.Path,
		})
		require.NoError(t, err)
		return len(comments.Comments) == 3
	}, time.Second*2, time.Millisecond*100, "We should have three comments, including carol's")

	_, err = alice.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: carolHome.Account,
	})
	require.NoError(t, err, "We want the profile of the comment's creator")

	carolHomeGotten, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: carolIdentity.Account.Principal().String(),
	})
	require.NoError(t, err)
	require.NotNil(t, carolHomeGotten.Metadata)
	time.Sleep(time.Millisecond * 100)

	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   doc.Account,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 100)

	docGotten, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc.Account,
		Path:    doc.Path,
	})
	require.NoError(t, err)
	require.Equal(t, doc.Content, docGotten.Content)
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: dummyAcc.Account,
		Path:    dummyAcc.Path,
	})
	require.Error(t, err)
}
