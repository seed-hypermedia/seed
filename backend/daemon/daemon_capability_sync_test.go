package daemon

import (
	"context"
	crand "crypto/rand"
	"sync/atomic"
	"testing"
	"time"

	"seed/backend/api/apitest"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	activity "seed/backend/genproto/activity/v1alpha"
	documents "seed/backend/genproto/documents/v3alpha"
	networking "seed/backend/genproto/networking/v1alpha"
	"seed/backend/hmnet"
	"seed/backend/hmnet/syncing"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// This file holds the end-to-end regression tests for capability propagation
// through a relay (the "site shows N collaborators, a synced peer shows fewer"
// class of bugs). Shared topology: Alice (owner) -> Site (relay) -> Bob
// (subscriber); Bob never connects to Alice, so everything he sees must come
// out of the relay's advertised reconciliation set.

// fastSyncConfig is the usual fast-cadence test config for sync e2e tests.
func fastSyncConfig(t *testing.T) config.Config {
	cfg := makeTestConfig(t)
	cfg.Syncing.RefreshInterval = time.Millisecond * 100
	cfg.Syncing.Interval = time.Millisecond * 200
	cfg.Syncing.WarmupDuration = time.Millisecond
	return cfg
}

// TestCapabilitySyncRecoversFromHookFailure is the end-to-end reproduction of
// the field regression where writer capabilities stopped reaching subscribers:
// a relay serving reconciliation from the maintained RBSR index loses the hook
// batch that should have added freshly granted capabilities to its advertised
// set (here: one injected transient failure, in production: writer contention,
// disk pressure, a crash window). The subscriber only ever talks to the relay,
// so a dropped batch is a hole it can never see past.
//
// Pre-fix, the failed chunk was logged and dropped: the relay advertises a set
// without the capabilities, the subscriber never wants them, and the only
// repair is the 30s shadow-verify rotation — which the field failure starved
// via the serve-fallback/cold-skip trap, making the hole permanent. Post-fix,
// applyIndexedHook retries the chunk, so the capabilities are advertised within
// milliseconds and the subscriber's next wave fetches them.
//
// Topology: Alice (owner) -> Site (relay) -> Bob (subscriber). Bob never
// connects to Alice. The assertion window is deliberately shorter than the
// shadow-verify tick so the sweep cannot mask the dropped chunk.
func TestCapabilitySyncRecoversFromHookFailure(t *testing.T) {
	t.Parallel()

	alice := makeTestApp(t, "alice", fastSyncConfig(t), true)
	site := makeTestApp(t, "bob", fastSyncConfig(t), true)
	bob := makeTestApp(t, "carol", fastSyncConfig(t), true)

	aliceIdentity := coretest.NewTester("alice")
	aliceAccount := aliceIdentity.Account.PublicKey.String()
	writer := coretest.NewTester("david")

	ctx := context.Background()

	// Phase 1: Alice publishes her home document.
	_, err := createTestDocumentChange(ctx, t, alice, &apitest.DocumentChangeRequest{
		Account:        aliceAccount,
		Path:           "",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice Home"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{Id: "b1", Type: "paragraph", Text: "Hello"},
			}},
		},
	})
	require.NoError(t, err)

	// Phase 2: the relay connects to Alice and subscribes to her space; Bob
	// connects ONLY to the relay and subscribes too. Serving Bob materializes
	// the relay's maintained scope for this discovery key.
	_, err = site.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)
	_, err = site.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceAccount,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)

	_, err = bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(site.Net.AddrInfo()),
	})
	require.NoError(t, err)
	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceAccount,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		_, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: aliceAccount,
			Path:    "",
		})
		return err == nil
	}, time.Second*10, time.Millisecond*200, "Bob must sync Alice's home through the relay")

	// Phase 3: quiesce, so the relay's scopes are warm-materialized and no
	// discovery is in flight before the failure is armed.
	time.Sleep(time.Second)

	// Phase 4: wrap the relay's indexed hook so the FIRST batch after arming —
	// the one carrying the fresh capability — fails once. Everything else
	// (including any retry of that same batch) behaves normally.
	var failNext atomic.Bool
	site.Index.SetIndexedHook(func(conn *sqlite.Conn, ids []int64) error {
		if failNext.CompareAndSwap(true, false) {
			return errTransientHook
		}
		return syncing.MaintainRBSRIndex(conn, ids)
	})
	failNext.Store(true)

	// Phase 5: Alice grants a root-path WRITER capability (stored at the home
	// document's IRI) and pushes it to the relay.
	_, err = alice.RPC.DocumentsV3.CreateCapability(ctx, &documents.CreateCapabilityRequest{
		SigningKeyName: "main",
		Delegate:       writer.Account.String(),
		Account:        aliceAccount,
		Path:           "",
		Role:           documents.Role_WRITER,
	})
	require.NoError(t, err)
	pushDocuments(t, alice, site, "hm://"+aliceAccount)

	// The relay itself holds the capability either way: structural indexing is
	// unaffected by the hook — only the ADVERTISED set is at stake.
	require.Eventually(t, func() bool {
		list, err := site.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
			Account: aliceAccount,
			Path:    "",
		})
		return err == nil && len(list.Capabilities) == 1
	}, time.Second*5, time.Millisecond*100, "the relay must hold the capability itself")

	// Phase 6: Bob — who only talks to the relay — must still receive it. The
	// 15s window is shorter than the 30s shadow-verify tick on purpose: only
	// the hook (retried post-fix, dropped pre-fix) can advertise it in time.
	require.Eventually(t, func() bool {
		list, err := bob.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
			Account: aliceAccount,
			Path:    "",
		})
		return err == nil && len(list.Capabilities) == 1
	}, time.Second*15, time.Millisecond*200,
		"a capability whose index-hook batch failed once must still reach the subscriber")
}

// errTransientHook is the injected one-shot failure for the test above.
var errTransientHook = errTransient{}

type errTransient struct{}

func (errTransient) Error() string { return "injected transient hook failure" }

// TestCapabilitiesSyncAfterScopeQuiesced is the happy-path guard for the same
// class of failure: writer capabilities granted AFTER the relay's serving
// scope has materialized (and the subscriber's waves have gone quiet) must
// still reach the subscriber through the relay's incrementally maintained
// advertised set — no re-materialization, no failure injection. Where the
// hook-failure test above pins the repair path, this one pins the everyday
// incremental path (root grants live at the home document's IRI; sub-document
// grants at their own; the sub-document listing walks ancestors).
func TestCapabilitiesSyncAfterScopeQuiesced(t *testing.T) {
	t.Parallel()

	alice := makeTestApp(t, "alice", fastSyncConfig(t), true)
	site := makeTestApp(t, "bob", fastSyncConfig(t), true)
	bob := makeTestApp(t, "carol", fastSyncConfig(t), true)

	aliceIdentity := coretest.NewTester("alice")
	aliceAccount := aliceIdentity.Account.PublicKey.String()
	writerOne := coretest.NewTester("david")
	writerTwo := coretest.NewTester("carol") // the subscriber's own account gets the second grant

	ctx := context.Background()

	// Phase 1: Alice publishes her home document and a sub-document.
	_, err := createTestDocumentChange(ctx, t, alice, &apitest.DocumentChangeRequest{
		Account:        aliceAccount,
		Path:           "",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Alice Home"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{Id: "b1", Type: "paragraph", Text: "Hello"},
			}},
		},
	})
	require.NoError(t, err)

	aliceNotes, err := createTestDocumentChange(ctx, t, alice, &apitest.DocumentChangeRequest{
		Account:        aliceAccount,
		Path:           "/notes",
		SigningKeyName: "main",
		Changes: []*documents.DocumentChange{
			{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Notes"},
			}},
			{Op: &documents.DocumentChange_MoveBlock_{
				MoveBlock: &documents.DocumentChange_MoveBlock{BlockId: "b1", Parent: "", LeftSibling: ""},
			}},
			{Op: &documents.DocumentChange_ReplaceBlock{
				ReplaceBlock: &documents.Block{Id: "b1", Type: "paragraph", Text: "Scratch"},
			}},
		},
	})
	require.NoError(t, err)

	// Phase 2: the relay connects to Alice and subscribes to her whole space.
	_, err = site.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)
	_, err = site.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceAccount,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		_, err := site.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: aliceNotes.Account,
			Path:    aliceNotes.Path,
		})
		return err == nil
	}, time.Second*10, time.Millisecond*200, "the relay must sync Alice's documents")

	// Phase 3: Bob connects ONLY to the relay and subscribes to Alice's space.
	// Serving Bob is what materializes the relay's maintained scope for this
	// discovery key.
	_, err = bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(site.Net.AddrInfo()),
	})
	require.NoError(t, err)
	_, err = bob.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceAccount,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		_, err := bob.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: aliceNotes.Account,
			Path:    aliceNotes.Path,
		})
		return err == nil
	}, time.Second*10, time.Millisecond*200, "Bob must sync Alice's documents through the relay")

	// Phase 4: quiesce. Several sync intervals pass with nothing new, so every
	// scope is warm-materialized and Bob's waves have gone quiet.
	time.Sleep(time.Second)

	// Phase 5: Alice grants write capabilities AFTER the world has settled: two
	// root-path grants (stored at the home document's IRI) and one sub-document
	// grant. Push them to the relay so its incremental index maintenance — not
	// a fresh materialization — is what must advertise them to Bob.
	for _, grant := range []struct {
		delegate string
		path     string
	}{
		{writerOne.Account.String(), ""},
		{writerTwo.Account.String(), ""},
		{writerOne.Account.String(), aliceNotes.Path},
	} {
		_, err = alice.RPC.DocumentsV3.CreateCapability(ctx, &documents.CreateCapabilityRequest{
			SigningKeyName: "main",
			Delegate:       grant.delegate,
			Account:        aliceAccount,
			Path:           grant.path,
			Role:           documents.Role_WRITER,
		})
		require.NoError(t, err)
	}
	pushDocuments(t, alice, site, "hm://"+aliceAccount)
	pushDocuments(t, alice, site, "hm://"+aliceAccount+aliceNotes.Path)

	list, err := site.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
		Account: aliceAccount,
		Path:    "",
	})
	require.NoError(t, err)
	require.Len(t, list.Capabilities, 2, "the relay must hold the root capabilities before Bob can")

	// Phase 6: Bob — who only talks to the relay — must see all three grants.
	require.Eventually(t, func() bool {
		root, err := bob.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
			Account: aliceAccount,
			Path:    "",
		})
		if err != nil || len(root.Capabilities) != 2 {
			return false
		}
		notes, err := bob.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
			Account: aliceAccount,
			Path:    aliceNotes.Path,
		})
		// The sub-document listing walks ancestors, so it carries the two
		// root grants plus its own.
		return err == nil && len(notes.Capabilities) == 3
	}, time.Second*15, time.Millisecond*200,
		"capabilities granted after the relay's scopes materialized must still reach the subscriber")
}

// TestExactChildSyncWithTransitiveAgents exercises original signed capabilities
// across author -> relay -> subscriber, including an off-tree grant arriving
// after the relay has materialized the subscriber's exact-child scope.
func TestExactChildSyncWithTransitiveAgents(t *testing.T) {
	t.Parallel()
	ctx := t.Context()

	newApp := func(name string) *App {
		cfg := makeTestConfig(t)
		cfg.Syncing.NoPull = true // Every discovery below has an explicit completion boundary.
		cfg.P2P.NoPeerSharing = true
		return makeTestApp(t, name, cfg, true)
	}
	author := newApp("alice")
	relay := newApp("bob")
	subscriber := newApp("carol")
	owner := coretest.NewTester("alice").Account
	writer := coretest.NewTester("david").Account
	session := coretest.NewTester("carol").Account
	agent, err := core.GenerateKeyPair(core.Ed25519, crand.Reader)
	require.NoError(t, err)
	lateSession, err := core.GenerateKeyPair(core.Ed25519, crand.Reader)
	require.NoError(t, err)
	for name, key := range map[string]*core.KeyPair{"writer": writer, "agent": agent, "session": session} {
		require.NoError(t, author.RPC.Daemon.RegisterAccount(ctx, name, key))
	}

	require.NoError(t, subscriber.RPC.Daemon.RegisterAccount(ctx, "late-session", lateSession))

	publish := func(key, account, path, title string, visibility documents.ResourceVisibility) *documents.Document {
		t.Helper()
		doc, err := createTestDocumentChange(ctx, t, author, &apitest.DocumentChangeRequest{
			SigningKeyName: key,
			Account:        account,
			Path:           path,
			Visibility:     visibility,
			Changes: []*documents.DocumentChange{{Op: &documents.DocumentChange_SetMetadata_{
				SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: title},
			}}},
		})
		require.NoError(t, err)
		return doc
	}
	grant := func(key, account, delegate, path string, role documents.Role) *documents.Capability {
		t.Helper()
		capability, err := author.RPC.DocumentsV3.CreateCapability(ctx, &documents.CreateCapabilityRequest{
			SigningKeyName: key,
			Account:        account,
			Delegate:       delegate,
			Path:           path,
			Role:           role,
		})
		require.NoError(t, err)
		return capability
	}

	// Project the owner namespace and the writer identity from private content
	// first. Their local provenance must not become a sync dependency of grants.
	privateOwner := publish("main", owner.String(), "/private", "Owner secret", documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE)
	privateWriter := publish("writer", writer.String(), "/private", "Writer secret", documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE)
	home := publish("main", owner.String(), "", "Podcast space", documents.ResourceVisibility_RESOURCE_VISIBILITY_PUBLIC)
	parent := publish("main", owner.String(), "/podcasts", "Podcasts", documents.ResourceVisibility_RESOURCE_VISIBILITY_PUBLIC)
	sibling := publish("main", owner.String(), "/podcasts/episode-2", "Unrequested sibling", documents.ResourceVisibility_RESOURCE_VISIBILITY_PUBLIC)
	siblingGrant := grant("main", owner.String(), coretest.NewTester("bob").Account.String(), sibling.Path, documents.Role_WRITER)

	// Both AGENT capabilities live outside the owner's resource tree. The
	// session has no direct WRITER grant, only writer -> agent -> session.
	capabilities := []*documents.Capability{
		grant("main", owner.String(), writer.String(), parent.Path, documents.Role_WRITER),
		grant("writer", writer.String(), agent.String(), "", documents.Role_AGENT),
		grant("agent", agent.String(), session.String(), "", documents.Role_AGENT),
	}
	published := publish("session", owner.String(), "/podcasts/episode-1", "Delegated episode", documents.ResourceVisibility_RESOURCE_VISIBILITY_PUBLIC)
	childIRI := blob.IRI("hm://" + owner.String() + published.Path)

	// Read raw storage rather than an access-filtered document listing: a
	// hidden-but-downloaded private blob is still a replication failure.
	assertAbsent := func(app *App, docs ...*documents.Document) {
		t.Helper()
		for _, doc := range docs {
			_, err := app.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{Account: doc.Account, Path: doc.Path})
			require.Error(t, err, "unrequested document %s%s", doc.Account, doc.Path)
			principal, err := core.DecodePrincipal(doc.Account)
			require.NoError(t, err)
			refs, err := author.RPC.DocumentsV3.ListRefs(blob.WithAuthenticatedCaller(ctx, principal), &documents.ListRefsRequest{
				Account: doc.Account,
				Path:    doc.Path,
			})
			require.NoError(t, err)
			require.NotEmpty(t, refs.Refs)
			ids := []string{doc.Version}
			for _, ref := range refs.Refs {
				ids = append(ids, ref.Id)
			}

			for _, id := range ids {
				c, err := cid.Decode(id)
				require.NoError(t, err)
				count, err := sqlitex.QueryOnePool[int64](ctx, app.Storage.DB(), dqb.Str(`
					SELECT COUNT(*) FROM blobs WHERE multihash = ? AND size >= 0;
				`)(), []byte(c.Hash()))
				require.NoError(t, err)
				require.Zero(t, count, "unrequested Ref/Change %s for %s%s", id, doc.Account, doc.Path)
			}
		}
	}
	assertCapabilities := func(app *App, caps []*documents.Capability) {
		t.Helper()
		for _, capability := range caps {
			got, err := app.RPC.DocumentsV3.GetCapability(ctx, &documents.GetCapabilityRequest{Id: capability.Id})
			require.NoError(t, err)
			require.True(t, proto.Equal(capability, got), "capability %s must retain its original fields", capability.Id)
			c, err := cid.Decode(capability.Id)
			require.NoError(t, err)
			original, err := author.Index.Get(ctx, c)
			require.NoError(t, err)
			received, err := app.Index.Get(ctx, c)
			require.NoError(t, err)
			require.Equal(t, original.RawData(), received.RawData(), "signed capability bytes must not change")
		}
	}
	syncScope := func(app *App, iri blob.IRI, recursive bool, want *documents.Document, caps []*documents.Capability) {
		t.Helper()
		require.EventuallyWithT(t, func(collect *assert.CollectT) {
			waveCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			progress := syncing.NewDiscoveryProgress()
			version, err := app.Syncing.DiscoverObjectWithProgress(waveCtx, iri, "", recursive, false, nil, progress)
			require.NoError(collect, err)
			require.Equal(collect, want.Version, version.String())
			require.Positive(collect, progress.PeersSyncedOK.Load(), "the explicit wave must reconcile with a real peer")
			for _, capability := range caps {
				_, err := app.RPC.DocumentsV3.GetCapability(ctx, &documents.GetCapabilityRequest{Id: capability.Id})
				require.NoError(collect, err, "sync must deliver capability %s", capability.Id)
			}
		}, 10*time.Second, 100*time.Millisecond)
		got, err := app.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{Account: want.Account, Path: want.Path})
		require.NoError(t, err)
		require.True(t, proto.Equal(want, got), "the peer must reconstruct the same published document")
		assertCapabilities(app, caps)
	}

	require.NoError(t, relay.Net.ForceConnect(ctx, author.Net.AddrInfo()))
	// The relay holds the sibling and its grant too, so their absence on the
	// subscriber tests serving isolation, not missing source data.
	syncScope(relay, blob.IRI("hm://"+owner.String()), true, home, append(append([]*documents.Capability{}, capabilities...), siblingGrant))
	gotSibling, err := relay.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{Account: owner.String(), Path: sibling.Path})
	require.NoError(t, err)
	require.Equal(t, sibling.Version, gotSibling.Version)
	assertAbsent(relay, privateOwner, privateWriter)

	var contactedOtherPeer atomic.Bool

	notifier := &network.NotifyBundle{ConnectedF: func(_ network.Network, conn network.Conn) {
		if conn.RemotePeer() != relay.Net.AddrInfo().ID {
			contactedOtherPeer.Store(true)
		}
	}}
	subscriber.Net.Libp2p().Network().Notify(notifier)
	t.Cleanup(func() { subscriber.Net.Libp2p().Network().StopNotify(notifier) })
	require.NoError(t, subscriber.Net.ForceConnect(ctx, relay.Net.AddrInfo()))
	syncScope(subscriber, childIRI, false, published, capabilities)
	assertAbsent(subscriber, parent, sibling, privateOwner, privateWriter)
	_, err = subscriber.RPC.DocumentsV3.GetCapability(ctx, &documents.GetCapabilityRequest{Id: siblingGrant.Id})
	require.Error(t, err, "an unrelated sibling grant must not replicate")

	warmScope, err := sqlitex.QueryOnePool[int64](ctx, relay.Storage.DB(), dqb.Str(`
		SELECT id FROM rbsr_scope WHERE iri = ? AND kind = 0 AND materialized = 1;
	`)(), string(childIRI))
	require.NoError(t, err, "the relay's exact scope must be materialized before the late grant")
	require.Positive(t, warmScope)

	refRequest := func(key, path string) *documents.CreateRefRequest {
		return &documents.CreateRefRequest{
			SigningKeyName: key,
			Account:        owner.String(),
			Path:           path,
			Target: &documents.RefTarget{Target: &documents.RefTarget_Version_{
				Version: &documents.RefTarget_Version{Genesis: published.Genesis, Version: published.Version},
			}},
		}
	}
	_, err = subscriber.RPC.DocumentsV3.CreateRef(ctx, refRequest("late-session", published.Path))
	require.Equal(t, codes.PermissionDenied, status.Code(err), "a local key without a grant must be denied")
	_, err = subscriber.RPC.DocumentsV3.CreateRef(ctx, refRequest("main", "/outside-podcasts"))
	require.Equal(t, codes.PermissionDenied, status.Code(err), "transitive agents must not escape the WRITER subtree")
	_, err = subscriber.RPC.DocumentsV3.CreateRef(ctx, refRequest("main", published.Path))
	require.NoError(t, err, "the cold synced chain must authorize the subscriber's session through the API")

	// A new leaf off the same identity chain must join an already-served exact
	// scope without subscribing to the writer's or agent's account roots.
	lateGrant := grant("agent", agent.String(), lateSession.String(), "", documents.Role_AGENT)
	capabilities = append(capabilities, lateGrant)
	syncScope(relay, childIRI, false, published, capabilities)
	syncScope(subscriber, childIRI, false, published, capabilities)
	_, err = subscriber.RPC.DocumentsV3.CreateRef(ctx, refRequest("late-session", published.Path))
	require.NoError(t, err, "the late off-tree AGENT grant must enable transitive API authority")
	_, err = subscriber.RPC.DocumentsV3.CreateRef(ctx, refRequest("late-session", "/outside-podcasts"))
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	updated, err := createTestDocumentChange(ctx, t, subscriber, &apitest.DocumentChangeRequest{
		SigningKeyName: "late-session",
		Account:        owner.String(),
		Path:           published.Path,
		BaseVersion:    published.Version,
		Changes: []*documents.DocumentChange{{Op: &documents.DocumentChange_SetMetadata_{
			SetMetadata: &documents.DocumentChange_SetMetadata{Key: "title", Value: "Edited through the late session"},
		}}},
	})
	require.NoError(t, err)
	require.NotEqual(t, published.Version, updated.Version)
	require.Equal(t, "Edited through the late session", updated.Metadata.Fields["title"].GetStringValue())
	assertAbsent(subscriber, parent, sibling, privateOwner, privateWriter)
	_, err = subscriber.RPC.DocumentsV3.GetCapability(ctx, &documents.GetCapabilityRequest{Id: siblingGrant.Id})
	require.Error(t, err)
	require.False(t, contactedOtherPeer.Load(), "the subscriber must never contact the author or any peer except the relay")
	require.ElementsMatch(t, []peer.ID{relay.Net.AddrInfo().ID}, subscriber.Net.Libp2p().Network().Peers())
}
