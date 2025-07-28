package daemon

import (
	"context"
	"seed/backend/api/apitest"
	documentsimpl "seed/backend/api/documents/v3alpha"
	"seed/backend/core"
	"seed/backend/core/coretest"
	activity "seed/backend/genproto/activity/v1alpha"
	daemon "seed/backend/genproto/daemon/v1alpha"
	documents "seed/backend/genproto/documents/v3alpha"
	entities "seed/backend/genproto/entities/v1alpha"
	networking "seed/backend/genproto/networking/v1alpha"
	"seed/backend/hmnet"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/structpb"
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
	alice := coretest.NewTester("alice").Account.Principal()

	doc, err := dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice, "", "", "main").
		SetMetadata("title", "Alice from the Wonderland").
		MoveBlock("b1", "", "").
		ReplaceBlock("b1", "paragraph", "Hello").
		MoveBlock("b2", "b1", "").
		ReplaceBlock("b2", "paragraph", "World!").
		Build(),
	)
	require.NoError(t, err)

	want := &documents.Document{
		Account: alice.String(),
		Path:    "",
		Metadata: must.Do2(structpb.NewStruct(map[string]any{
			"title": "Alice from the Wonderland",
		})),
		Authors: []string{alice.String()},
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

	// Do another update.

	{
		doc, err := dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice, "", doc.Version, "main").
			SetMetadata("title", "Just Alice").
			Build(),
		)
		require.NoError(t, err)

		want := &documents.Document{
			Account: alice.String(),
			Path:    "",
			Metadata: must.Do2(structpb.NewStruct(map[string]any{
				"title": "Just Alice",
			})),
			Authors: []string{alice.String()},
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
}

func TestConnectivity(t *testing.T) {
	t.Parallel()
	aliceCfg := makeTestConfig(t)
	aliceCfg.Syncing.Interval = time.Millisecond * 100
	aliceCfg.Syncing.WarmupDuration = time.Millisecond * 200
	aliceCfg.Syncing.NoPull = true
	alice := makeTestApp(t, "alice", aliceCfg, true)
	ctx := context.Background()

	bobCfg := makeTestConfig(t)
	bobCfg.Syncing.Interval = time.Millisecond * 100
	bobCfg.Syncing.WarmupDuration = time.Millisecond * 200
	bobCfg.Syncing.NoPull = true
	bob := makeTestApp(t, "bob", bobCfg, true)

	_, err := bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
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
		Account:        aliceIdentity.Account.PublicKey.String(),
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
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
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
		Account: aliceIdentity.Account.PublicKey.String(),
		Path:    "",
	})
	require.NoError(t, err)
	require.Equal(t, doc.Content, doc2.Content)

	bobsProfile, err := bob.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        bobIdentity.Account.PublicKey.String(),
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

	alice := makeTestApp(t, "alice", makeTestConfig(t), true)
	bob := makeTestApp(t, "bob", makeTestConfig(t), true)
	ctx := context.Background()

	aliceHome, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        must.Do2(alice.Storage.KeyStore().GetKey(ctx, "main")).String(),
		Path:           "",
		SigningKeyName: "main",
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

	require.NoError(t, bob.Net.ForceConnect(ctx, alice.Net.AddrInfo()))

	var count int
	for {
		count++
		res, err := bob.RPC.Entities.DiscoverEntity(ctx, &entities.DiscoverEntityRequest{
			Account: aliceHome.Account,
		})
		require.NoError(t, err)
		if res.Version == aliceHome.Version {
			break
		}
		time.Sleep(100 * time.Millisecond)
		if count > 100 {
			t.Fatalf("Failed to discover the document!")
		}
	}

	bobGot, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceHome.Account,
		Path:    "",
	})
	require.NoError(t, err)

	testutil.StructsEqual(aliceHome, bobGot).Compare(t, "bob must get alice's home document intact")
}

func TestSubscriptions(t *testing.T) {
	t.Parallel()
	aliceCfg := makeTestConfig(t)
	aliceCfg.Syncing.RefreshInterval = time.Millisecond * 100
	aliceCfg.Syncing.Interval = time.Millisecond * 200
	aliceCfg.Syncing.WarmupDuration = time.Millisecond
	alice := makeTestApp(t, "alice", aliceCfg, true)
	aliceIdentity := coretest.NewTester("alice")

	bobCfg := makeTestConfig(t)
	bobCfg.Syncing.RefreshInterval = time.Millisecond * 100
	bobCfg.Syncing.Interval = time.Millisecond * 200
	bobCfg.Syncing.WarmupDuration = time.Millisecond
	bob := makeTestApp(t, "bob", bobCfg, true)
	bobIdentity := coretest.NewTester("bob")

	carolCfg := makeTestConfig(t)
	carolCfg.Syncing.RefreshInterval = time.Millisecond * 100
	carolCfg.Syncing.Interval = time.Millisecond * 200
	carolCfg.Syncing.WarmupDuration = time.Millisecond
	carol := makeTestApp(t, "carol", carolCfg, true)
	carolIdentity := coretest.NewTester("carol")

	ctx := context.Background()

	carolHome, err := carol.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        carolIdentity.Account.PublicKey.String(),
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

	aliceHome, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.PublicKey.String(),
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

	aliceToyota, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.PublicKey.String(),
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

	aliceHonda, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.PublicKey.String(),
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

	david := coretest.NewTester("david")
	require.NoError(t, alice.Storage.KeyStore().StoreKey(ctx, "david", david.Account))

	davidInAliceHome, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        david.Account.String(),
		Path:           "",
		SigningKeyName: "david",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Hidden Account"},
			}},
		},
	})
	require.NoError(t, err)

	bobHome, err := bob.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        bobIdentity.Account.PublicKey.String(),
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
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)

	time.Sleep(time.Millisecond * 300)
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceToyota.Account,
		Path:    aliceToyota.Path,
	})
	require.Error(t, err)

	// Force sync will sync subscribed content. Since there is no subscriptions,
	// no content is expected to be synced
	_, err = bob.RPC.Daemon.ForceSync(ctx, &daemon.ForceSyncRequest{})
	require.NoError(t, err)

	time.Sleep(time.Millisecond * 100)
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceToyota.Account,
		Path:    aliceToyota.Path,
	})
	require.Error(t, err)

	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceToyota.Account,
		Path:      aliceToyota.Path,
		Recursive: false,
	})
	require.NoError(t, err)

	res, err := bob.RPC.Activity.ListSubscriptions(ctx, &activity.ListSubscriptionsRequest{})
	require.NoError(t, err)
	require.Len(t, res.Subscriptions, 1)
	require.Equal(t, aliceToyota.Account, res.Subscriptions[0].Account)
	require.Equal(t, aliceToyota.Path, res.Subscriptions[0].Path)
	time.Sleep(time.Millisecond * 100)

	_, err = alice.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: bobHome.Account,
		Path:    bobHome.Path,
	})
	require.Error(t, err)

	bobGotAliceToyota, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceToyota.Account,
		Path:    aliceToyota.Path,
	})
	require.NoError(t, err)
	require.Equal(t, aliceToyota.Content, bobGotAliceToyota.Content)

	// We should not sync this document since we did not subscribe recursively.
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceHonda.Account,
		Path:    aliceHonda.Path,
	})
	require.Error(t, err)

	_, err = bob.RPC.Activity.Unsubscribe(ctx, &activity.UnsubscribeRequest{
		Account: aliceToyota.Account,
		Path:    aliceToyota.Path,
	})
	require.NoError(t, err)

	res, err = bob.RPC.Activity.ListSubscriptions(ctx, &activity.ListSubscriptionsRequest{})
	require.NoError(t, err)
	require.Len(t, res.Subscriptions, 0)

	// we have 2 subscriptions to force the multiple subscriptions error
	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceHonda.Account,
		Path:      "/non/existing/path",
		Recursive: false,
	})
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 100)
	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceHonda.Account,
		Path:      "/cars",
		Recursive: true,
	})
	require.NoError(t, err)

	time.Sleep(time.Millisecond * 200)

	bobGotAliceHonda, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceHonda.Account,
		Path:    aliceHonda.Path,
	})
	require.NoError(t, err)
	require.Equal(t, aliceHonda.Content, bobGotAliceHonda.Content)

	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceHome.Account,
		Path:    aliceHome.Path,
	})
	require.Error(t, err, "bob is not explicitly subscribed to alice's home, so should not have it")

	aliceHondaUpdated, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        aliceIdentity.Account.PublicKey.String(),
		BaseVersion:    aliceHonda.Version,
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
	require.NotEqual(t, aliceHonda.Version, aliceHondaUpdated.Version)
	require.Eventually(t, func() bool {
		bobGotAliceHonda, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: aliceHondaUpdated.Account,
			Path:    aliceHondaUpdated.Path,
		})
		require.NoError(t, err)
		return bobGotAliceHonda.Version == aliceHondaUpdated.Version
	}, time.Second*5, time.Millisecond*200, "We should get the modified version, not the previous one")

	require.Equal(t, aliceHondaUpdated.Content, bobGotAliceHonda.Content)

	bobComment, err := bob.RPC.DocumentsV3.CreateComment(ctx, &documents.CreateCommentRequest{
		TargetAccount: aliceHondaUpdated.Account,
		TargetPath:    aliceHondaUpdated.Path,
		TargetVersion: aliceHondaUpdated.Version,
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
		TargetAccount: aliceHondaUpdated.Account,
		TargetPath:    aliceHondaUpdated.Path,
	})
	require.NoError(t, err)
	require.Len(t, comments.Comments, 0)

	_, err = alice.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceHondaUpdated.Account,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 300)
	comments, err = alice.RPC.DocumentsV3.ListComments(ctx, &documents.ListCommentsRequest{
		TargetAccount: aliceHondaUpdated.Account,
		TargetPath:    aliceHondaUpdated.Path,
	})
	require.NoError(t, err)
	require.Len(t, comments.Comments, 1)
	require.Equal(t, bobComment.Content, comments.Comments[0].Content)

	reply, err := alice.RPC.DocumentsV3.CreateComment(ctx, &documents.CreateCommentRequest{
		TargetAccount:  aliceHondaUpdated.Account,
		TargetPath:     aliceHondaUpdated.Path,
		TargetVersion:  aliceHondaUpdated.Version,
		ReplyParent:    bobComment.Id,
		Content:        []*documents.BlockNode{{Block: &documents.Block{Id: "b1", Type: "paragraph", Text: "Hello back, Bob!"}, Children: []*documents.BlockNode{{Block: &documents.Block{Id: "b2", Type: "paragraph", Text: "Love your comment"}}}}},
		SigningKeyName: "main",
		Capability:     "",
	})
	require.NoError(t, err)

	cpb, err := alice.RPC.DocumentsV3.CreateCapability(ctx, &documents.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       bobIdentity.Account.String(),
		Account:        aliceIdentity.Account.PublicKey.String(),
		Path:           aliceHonda.Path,
		Role:           documents.Role_WRITER,
	})
	require.NoError(t, err)
	require.NotNil(t, cpb)
	list, err := alice.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
		Account: aliceIdentity.Account.PublicKey.String(),
		Path:    aliceHonda.Path,
	})
	require.NoError(t, err)
	require.Len(t, list.Capabilities, 1, "must return the capability")

	require.Eventually(t, func() bool {
		comments, err = bob.RPC.DocumentsV3.ListComments(ctx, &documents.ListCommentsRequest{
			TargetAccount: aliceHondaUpdated.Account,
			TargetPath:    aliceHondaUpdated.Path,
		})
		require.NoError(t, err)
		return len(comments.Comments) == 2
	}, time.Second*5, time.Millisecond*200, "We should have two comments, the initial comment and the reply")
	require.Equal(t, reply.Content, comments.Comments[1].Content)

	bobsCap, err := bob.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
		Account: aliceIdentity.Account.PublicKey.String(),
		Path:    aliceHonda.Path,
	})
	require.NoError(t, err)
	require.Len(t, bobsCap.Capabilities, 1, "must return the capability")

	_, err = carol.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)

	var entity *entities.DiscoverEntityResponse

	var count int
	for {
		count++
		resp, err := carol.RPC.Entities.DiscoverEntity(ctx, &entities.DiscoverEntityRequest{
			Account: aliceHondaUpdated.Account,
			Path:    aliceHondaUpdated.Path,
		})
		require.NoError(t, err)
		if resp.Version == aliceHondaUpdated.Version {
			entity = resp
			break
		}

		time.Sleep(100 * time.Millisecond)
		if count > 100 {
			t.Fatal("Couldn't discover the document")
		}
	}

	carolRoots, err := carol.RPC.DocumentsV3.ListRootDocuments(ctx, &documents.ListRootDocumentsRequest{})
	require.NoError(t, err)
	require.Len(t, carolRoots.Documents, 1, "Carol must have Alice's & Bob's root document and her own")
	require.Equal(t, carolHome.Version, carolRoots.Documents[0].Version, "Carol must only have her own root document, because she is not explicitly subscribed to other roots")

	carolComment, err := carol.RPC.DocumentsV3.CreateComment(ctx, &documents.CreateCommentRequest{
		TargetAccount: aliceHondaUpdated.Account,
		TargetPath:    aliceHondaUpdated.Path,
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
			TargetAccount: aliceHondaUpdated.Account,
			TargetPath:    aliceHondaUpdated.Path,
		})
		require.NoError(t, err)
		return len(comments.Comments) == 3
	}, time.Second*2, time.Millisecond*100, "We should have three comments, including carol's")

	_, err = alice.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: carolHome.Account,
	})
	require.Error(t, err, "Commenter's profiles might be missing and need to be fetched separately")

	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: carolIdentity.Account.PublicKey.String(),
	})
	require.Error(t, err, "bob is not subscribed to carol's home")
	time.Sleep(time.Millisecond * 100)

	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceHome.Account,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)
	time.Sleep(time.Millisecond * 100)

	docGotten, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: aliceHome.Account,
		Path:    aliceHome.Path,
	})
	require.NoError(t, err)
	require.Equal(t, aliceHome.Content, docGotten.Content)
	_, err = bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: davidInAliceHome.Account,
		Path:    davidInAliceHome.Path,
	})
	require.Error(t, err)
}

func TestBug_BrokenFormattingAnnotations(t *testing.T) {
	t.Parallel()

	dmn := makeTestApp(t, "alice", makeTestConfig(t), true)
	ctx := context.Background()
	alice := coretest.NewTester("alice").Account.Principal()

	doc, err := dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, apitest.NewChangeBuilder(alice, "", "", "main").
		SetMetadata("title", "Alice from the Wonderland").
		MoveBlock("b1", "", "").
		ReplaceBlock("b1", "paragraph", "Hello world", &documents.Annotation{Type: "bold", Starts: []int32{0}, Ends: []int32{5}}).
		MoveBlock("b2", "b1", "").
		ReplaceBlock("b2", "paragraph", "World!").
		Build(),
	)
	require.NoError(t, err)
	require.NotNil(t, doc)
}

func TestBug_LeftOverDocumentsAfterDelete(t *testing.T) {
	t.Parallel()

	dmn := makeTestApp(t, "alice", makeTestConfig(t), true)
	ctx := context.Background()
	alice := coretest.NewTester("alice").Account.Principal()

	// Create initial document.
	doc, err := dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        alice.String(),
		Path:           "/test/doc",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Original Document"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Initial content",
				},
			}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, doc)

	// Create new ref to supercede the previous one.
	newRef, err := dmn.RPC.DocumentsV3.CreateRef(ctx, &documents.CreateRefRequest{
		Account:        alice.String(),
		Path:           "/test/doc",
		SigningKeyName: "main",
		Generation:     doc.GenerationInfo.Generation + 10,
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Version_{
				Version: &documents.RefTarget_Version{
					Genesis: doc.Genesis,
					Version: doc.Version,
				},
			},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, newRef)

	// Delete the document.
	_, err = dmn.RPC.DocumentsV3.CreateRef(ctx, &documents.CreateRefRequest{
		Account:        alice.String(),
		Path:           "/test/doc",
		SigningKeyName: "main",
		Target: &documents.RefTarget{
			Target: &documents.RefTarget_Tombstone_{},
		},
		Generation: newRef.GenerationInfo.Generation,
	})
	require.NoError(t, err)

	// List documents to verify the deleted ref doesn't appear
	docs, err := dmn.RPC.DocumentsV3.ListDocuments(ctx, &documents.ListDocumentsRequest{
		Account: alice.String(),
	})
	require.NoError(t, err)

	require.Len(t, docs.Documents, 0, "deleted document must not reveal previous generations in the list")

	_, err = dmn.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: doc.Account,
		Path:    doc.Path,
	})
	require.Error(t, err)
}

func TestKeyDelegation(t *testing.T) {
	t.Parallel()

	dmn := makeTestApp(t, "alice", makeTestConfig(t), true)
	ctx := t.Context()
	alice := coretest.NewTester("alice").Account.Principal()
	bob := coretest.NewTester("bob").Account.Principal()

	// Alice creates her home document.
	aliceHome, err := dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "main",
		Account:        alice.String(),
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetAttribute_{
				SetAttribute: &documents.DocumentChange_SetAttribute{
					Key: []string{"name"},
					Value: &documents.DocumentChange_SetAttribute_StringValue{
						StringValue: "Alice from the Wonderland",
					},
				},
			}},
		},
	})
	require.NoError(t, err)

	// Bob, whom in this case we treat as if it was Alice's phone or other device,
	// also creates his home document.
	require.NoError(t, dmn.RPC.Daemon.RegisterAccount(ctx, "bob", coretest.NewTester("bob").Account))
	_, err = dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "bob",
		Account:        bob.String(),
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetAttribute_{
				SetAttribute: &documents.DocumentChange_SetAttribute{
					Key: []string{"name"},
					Value: &documents.DocumentChange_SetAttribute_StringValue{
						StringValue: "Bobby Web Account",
					},
				},
			}},
		},
	})
	require.NoError(t, err)

	time.Sleep(30 * time.Millisecond)

	// Now Alice creates an agent capability for bob's key.
	cpb, err := dmn.RPC.DocumentsV3.CreateCapability(ctx, &documents.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       bob.String(),
		Account:        alice.String(),
		Role:           documents.Role_AGENT,
		Label:          "Phone web key",
	})
	require.NoError(t, err)
	_ = cpb

	time.Sleep(30 * time.Millisecond)

	// Bob claims Alice as alias.
	_, err = dmn.RPC.DocumentsV3.CreateAlias(ctx, &documents.CreateAliasRequest{
		SigningKeyName: "bob",
		AliasAccount:   alice.String(),
	})
	require.NoError(t, err)

	bobAcc, err := dmn.RPC.DocumentsV3.GetAccount(ctx, &documents.GetAccountRequest{
		Id: bob.String(),
	})
	require.NoError(t, err)

	require.Equal(t, alice.String(), bobAcc.AliasAccount, "bob must have alice as alias")

	// Now Bob edits alice's home document.
	_, err = dmn.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		SigningKeyName: "bob",
		Account:        alice.String(),
		BaseVersion:    aliceHome.Version,
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetAttribute_{
				SetAttribute: &documents.DocumentChange_SetAttribute{
					Key: []string{"name"},
					Value: &documents.DocumentChange_SetAttribute_StringValue{
						StringValue: "Alice from the Wonderland (updated by an agent key)",
					},
				},
			}},
		},
	})
	require.NoError(t, err)

	list, err := dmn.RPC.DocumentsV3.ListAccounts(ctx, &documents.ListAccountsRequest{})
	require.NoError(t, err)
	require.Len(t, list.Accounts, 2, "must have bob and alice accounts")

	var ids []string
	for _, x := range list.Accounts {
		item, err := dmn.RPC.DocumentsV3.GetAccount(ctx, &documents.GetAccountRequest{
			Id: x.Id,
		})
		require.NoError(t, err)
		testutil.StructsEqual(x, item).Compare(t, "account must match")
		ids = append(ids, item.Id)
	}

	batch, err := dmn.RPC.DocumentsV3.BatchGetAccounts(ctx, &documents.BatchGetAccountsRequest{
		Ids: ids,
	})
	require.NoError(t, err)
	require.Len(t, batch.Accounts, 2, "must have bob and alice accounts")
	require.Nil(t, batch.Errors, "must not have errors")

	for _, x := range list.Accounts {
		testutil.StructsEqual(x, batch.Accounts[x.Id]).Compare(t, "account must match")
	}
}

func TestDelegatedProfileUpdate(t *testing.T) {
	t.Parallel()

	dmn := makeTestApp(t, "alice", makeTestConfig(t), true)
	ctx := t.Context()

	// Create first key (Alice).
	alice := coretest.NewTester("alice").Account.Principal()

	// Create initial profile for Alice.
	initialProfile := &documents.Profile{
		Name:        "Alice",
		Description: "Primary account holder",
	}

	_, err := dmn.RPC.DocumentsV3.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		Account:        alice.String(),
		Profile:        initialProfile,
		SigningKeyName: "main",
	})
	require.NoError(t, err)

	// Verify Alice's profile was set correctly.
	aliceAccount, err := dmn.RPC.DocumentsV3.GetAccount(ctx, &documents.GetAccountRequest{
		Id: alice.String(),
	})
	require.NoError(t, err)
	require.Equal(t, initialProfile.Name, aliceAccount.Profile.Name)
	require.Equal(t, initialProfile.Icon, aliceAccount.Profile.Icon)
	require.Equal(t, initialProfile.Description, aliceAccount.Profile.Description)

	// Create second key (Bob).
	bob := coretest.NewTester("bob").Account.Principal()
	require.NoError(t, dmn.RPC.Daemon.RegisterAccount(ctx, "bob", coretest.NewTester("bob").Account))

	// Create Bob's profile.
	bobProfile := &documents.Profile{
		Name:        "Bob",
		Description: "Secondary device",
	}

	_, err = dmn.RPC.DocumentsV3.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		Account:        bob.String(),
		Profile:        bobProfile,
		SigningKeyName: "bob",
	})
	require.NoError(t, err)

	// Perform device delegation - Alice delegates to Bob.
	_, err = dmn.RPC.DocumentsV3.CreateCapability(ctx, &documents.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       bob.String(),
		Account:        alice.String(),
		Role:           documents.Role_AGENT,
		Label:          "Bob's device key",
	})
	require.NoError(t, err)

	time.Sleep(30 * time.Millisecond)

	// Bob claims Alice as alias.
	_, err = dmn.RPC.DocumentsV3.CreateAlias(ctx, &documents.CreateAliasRequest{
		SigningKeyName: "bob",
		AliasAccount:   alice.String(),
	})
	require.NoError(t, err)

	// Verify Bob has Alice as alias.
	bobAccount, err := dmn.RPC.DocumentsV3.GetAccount(ctx, &documents.GetAccountRequest{
		Id: bob.String(),
	})
	require.NoError(t, err)
	require.Equal(t, alice.String(), bobAccount.AliasAccount, "bob must have alice as alias")

	time.Sleep(30 * time.Millisecond)

	// Now Bob updates Alice's profile using his delegated key.
	updatedProfile := &documents.Profile{
		Name: "Alice (updated)",
	}

	_, err = dmn.RPC.DocumentsV3.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		Account:        alice.String(),
		Profile:        updatedProfile,
		SigningKeyName: "bob", // Using Bob's key to update Alice's profile
	})
	require.NoError(t, err)

	// Verify Alice's profile was updated correctly
	aliceAccountUpdated, err := dmn.RPC.DocumentsV3.GetAccount(ctx, &documents.GetAccountRequest{
		Id: alice.String(),
	})
	require.NoError(t, err)
	require.Equal(t, updatedProfile.Name, aliceAccountUpdated.Profile.Name)
	require.Equal(t, updatedProfile.Icon, aliceAccountUpdated.Profile.Icon)
	require.Equal(t, initialProfile.Description, aliceAccountUpdated.Profile.Description)

	// Verify Bob's profile returns the alias.
	bobAccountUpdated, err := dmn.RPC.DocumentsV3.GetAccount(ctx, &documents.GetAccountRequest{
		Id: bob.String(),
	})
	require.NoError(t, err)
	require.Nil(t, bobAccountUpdated.Profile)
	require.Equal(t, alice.String(), bobAccountUpdated.AliasAccount)
}

func TestBug_MissingProfileAlias(t *testing.T) {
	t.Parallel()

	alice := makeTestApp(t, "alice", makeTestConfig(t), true)
	aliceKey := coretest.NewTester("alice").Account
	bobKey := coretest.NewTester("bob").Account
	ctx := t.Context()
	require.NoError(t, alice.RPC.Daemon.RegisterAccount(ctx, "bob", bobKey))

	_, err := alice.RPC.DocumentsV3.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		SigningKeyName: "main",
		Account:        aliceKey.String(),
		Profile: &documents.Profile{
			Name: "Alice from the Wonderland",
		},
	})
	require.NoError(t, err)

	// Sleeps here are just to make sure timestamps of the blobs have some difference between them.

	time.Sleep(5 * time.Millisecond)

	_, err = alice.RPC.DocumentsV3.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		SigningKeyName: "bob",
		Account:        bobKey.String(),
		Profile: &documents.Profile{
			Name: "Bobby",
		},
	})
	require.NoError(t, err)

	time.Sleep(5 * time.Millisecond)

	// Alice delegates to Bob.
	_, err = alice.RPC.DocumentsV3.CreateCapability(ctx, &documents.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       bobKey.String(),
		Account:        must.Do2(alice.Storage.KeyStore().GetKey(ctx, "main")).String(),
		Role:           documents.Role_AGENT,
		Label:          "Bob's key",
	})
	require.NoError(t, err)

	time.Sleep(5 * time.Millisecond)

	// Bob claims Alice as an alias.
	_, err = alice.RPC.DocumentsV3.CreateAlias(ctx, &documents.CreateAliasRequest{
		SigningKeyName: "bob",
		AliasAccount:   aliceKey.String(),
	})
	require.NoError(t, err)

	carol := makeTestApp(t, "carol", makeTestConfig(t), true)

	// Carol connects to Alice.
	_, err = carol.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)

	// Carol discovers bob's account.
	for {
		resp, err := carol.RPC.Entities.DiscoverEntity(ctx, &entities.DiscoverEntityRequest{
			Account:   bobKey.String(),
			Path:      "",
			Recursive: true,
		})
		require.NoError(t, err)

		if resp.State == entities.DiscoveryTaskState_DISCOVERY_TASK_COMPLETED {
			break
		}

		time.Sleep(10 * time.Millisecond)
	}

	{
		resp, err := carol.RPC.DocumentsV3.GetAccount(ctx, &documents.GetAccountRequest{
			Id: bobKey.String(),
		})
		require.NoError(t, err)
		require.Equal(t, aliceKey.String(), resp.AliasAccount, "carol must discover that bob has alice as an alias")
	}
}

func TestRecursiveHomeDocumentDiscovery(t *testing.T) {
	t.Parallel()

	alice := makeTestApp(t, "alice", makeTestConfig(t), true)
	bob := makeTestApp(t, "bob", makeTestConfig(t), true)
	ctx := context.Background()

	// Get Bob's account key
	bobKey := must.Do2(bob.Storage.KeyStore().GetKey(ctx, "main"))

	// Create Bob's home document
	_, err := bob.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        bobKey.String(),
		Path:           "",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob's Home"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "Welcome to Bob's home page",
				},
			}},
		},
	})
	require.NoError(t, err)

	// Create subdocument 1
	_, err = bob.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        bobKey.String(),
		Path:           "/projects",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Bob's Projects"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "p1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "p1",
					Type: "paragraph",
					Text: "My cool projects",
				},
			}},
		},
	})
	require.NoError(t, err)

	// Create subdocument 2
	_, err = bob.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        bobKey.String(),
		Path:           "/notes/daily",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Daily Notes"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "n1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "n1",
					Type: "paragraph",
					Text: "Today I worked on the hypermedia project",
				},
			}},
		},
	})
	require.NoError(t, err)

	// Create subdocument 3
	_, err = bob.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        bobKey.String(),
		Path:           "/about/me",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "About Me"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "a1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "a1",
					Type: "paragraph",
					Text: "I'm Bob, a software engineer passionate about decentralized systems",
				},
			}},
		},
	})
	require.NoError(t, err)

	// Connect Alice and Bob
	require.NoError(t, bob.Net.ForceConnect(ctx, alice.Net.AddrInfo()))

	// Wait for connection to establish
	time.Sleep(100 * time.Millisecond)

	want, err := bob.RPC.DocumentsV3.ListDocuments(ctx, &documents.ListDocumentsRequest{
		Account:  bobKey.String(),
		PageSize: 1000,
	})
	require.NoError(t, err)
	slices.SortFunc(want.Documents, func(a, b *documents.DocumentInfo) int { return strings.Compare(a.Path, b.Path) })
	require.Len(t, want.Documents, 4, "Bob should have 4 documents in total")

	// Alice discovers Bob's home document recursively
	for {
		res, err := alice.RPC.Entities.DiscoverEntity(ctx, &entities.DiscoverEntityRequest{
			Account:   bobKey.String(),
			Path:      "",
			Recursive: true,
		})
		require.NoError(t, err)

		if res.State == entities.DiscoveryTaskState_DISCOVERY_TASK_COMPLETED {
			break
		}

		time.Sleep(10 * time.Millisecond)
	}

	// List all documents on Alice and print them
	docs, err := alice.RPC.DocumentsV3.ListDocuments(ctx, &documents.ListDocumentsRequest{
		Account: bobKey.String(),
	})
	require.NoError(t, err)
	slices.SortFunc(docs.Documents, func(a, b *documents.DocumentInfo) int { return strings.Compare(a.Path, b.Path) })

	require.Equal(t, len(want.Documents), len(docs.Documents), "Alice should have discovered all of Bob's documents")
	for i := range want.Documents {
		testutil.StructsEqual(want.Documents[i], docs.Documents[i]).
			IgnoreFields(documents.ActivitySummary{}, "IsUnread").
			Compare(t, "Document %d must match", i)
	}
}

func TestCommentDiscovery(t *testing.T) {
	t.Parallel()

	alice := makeTestApp(t, "alice", makeTestConfig(t), true)
	bob := makeTestApp(t, "bob", makeTestConfig(t), true)
	ctx := context.Background()

	// Alice creates a document.
	aliceDoc, err := alice.RPC.DocumentsV3.CreateDocumentChange(ctx, &documents.CreateDocumentChangeRequest{
		Account:        must.Do2(alice.Storage.KeyStore().GetKey(ctx, "main")).String(),
		Path:           "/test-doc",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Test Document"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{
					Id:   "b1",
					Type: "paragraph",
					Text: "This is a test document for commenting.",
				},
			}},
		},
	})
	require.NoError(t, err)

	// Alice creates a comment on the document.
	comment, err := alice.RPC.DocumentsV3.CreateComment(ctx, &documents.CreateCommentRequest{
		TargetAccount:  aliceDoc.Account,
		TargetPath:     aliceDoc.Path,
		TargetVersion:  aliceDoc.Version,
		SigningKeyName: "main",
		Content: []*documents.BlockNode{
			{Block: &documents.Block{Id: "c1", Type: "paragraph", Text: "This is Alice's comment."}},
		},
	})
	require.NoError(t, err)

	// Connect bob to alice.
	require.NoError(t, bob.Net.ForceConnect(ctx, alice.Net.AddrInfo()))

	// Wait a little bit for the connection to warm up.
	time.Sleep(200 * time.Millisecond)

	// Bob discovers the comment.
	var ok bool
	for range 100 {
		res, err := bob.RPC.Entities.DiscoverEntity(ctx, &entities.DiscoverEntityRequest{
			Account: aliceDoc.Account,
			Path:    strings.TrimPrefix(comment.Id, aliceDoc.Account), // Comment ID is a resource ID of form `{account}/{tsid}`, but we only want the path with the leading slash.
		})
		require.NoError(t, err)
		require.Equal(t, "", res.LastError, "comment discovery must not produce any errors")
		if res.Version == comment.Version {
			ok = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	require.True(t, ok, "bob must discover alice's comment")

	// Bob should be able to get the comment now.
	bobGotComment, err := bob.RPC.DocumentsV3.GetComment(ctx, &documents.GetCommentRequest{
		Id: comment.Id,
	})
	require.NoError(t, err)

	testutil.StructsEqual(comment, bobGotComment).Compare(t, "bob must get alice's comment intact")
}
