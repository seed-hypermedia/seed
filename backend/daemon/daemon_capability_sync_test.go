package daemon

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"seed/backend/api/apitest"
	"seed/backend/config"
	"seed/backend/core/coretest"
	activity "seed/backend/genproto/activity/v1alpha"
	documents "seed/backend/genproto/documents/v3alpha"
	networking "seed/backend/genproto/networking/v1alpha"
	"seed/backend/hmnet"
	"seed/backend/hmnet/syncing"
	"seed/backend/util/sqlite"

	"github.com/stretchr/testify/require"
)

// This file holds the end-to-end regression tests for capability propagation
// through a relay (the "space shows N collaborators, a synced peer shows fewer"
// class of bugs). Shared topology: Alice (owner) -> Space (relay) -> Bob
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
// Topology: Alice (owner) -> Space (relay) -> Bob (subscriber). Bob never
// connects to Alice. The assertion window is deliberately shorter than the
// shadow-verify tick so the sweep cannot mask the dropped chunk.
func TestCapabilitySyncRecoversFromHookFailure(t *testing.T) {
	t.Parallel()

	alice := makeTestApp(t, "alice", fastSyncConfig(t), true)
	space := makeTestApp(t, "bob", fastSyncConfig(t), true)
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
	_, err = space.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)
	_, err = space.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceAccount,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)

	_, err = bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(space.Net.AddrInfo()),
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
	space.Index.SetIndexedHook(func(conn *sqlite.Conn, ids []int64) error {
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
	pushDocuments(t, alice, space, "hm://"+aliceAccount)

	// The relay itself holds the capability either way: structural indexing is
	// unaffected by the hook — only the ADVERTISED set is at stake.
	require.Eventually(t, func() bool {
		list, err := space.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
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
	space := makeTestApp(t, "bob", fastSyncConfig(t), true)
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
	_, err = space.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(alice.Net.AddrInfo()),
	})
	require.NoError(t, err)
	_, err = space.RPC.Activity.Subscribe(ctx, &activity.SubscribeRequest{
		Account:   aliceAccount,
		Path:      "",
		Recursive: true,
	})
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		_, err := space.RPC.DocumentsV3.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: aliceNotes.Account,
			Path:    aliceNotes.Path,
		})
		return err == nil
	}, time.Second*10, time.Millisecond*200, "the relay must sync Alice's documents")

	// Phase 3: Bob connects ONLY to the relay and subscribes to Alice's space.
	// Serving Bob is what materializes the relay's maintained scope for this
	// discovery key.
	_, err = bob.RPC.Networking.Connect(ctx, &networking.ConnectRequest{
		Addrs: hmnet.AddrInfoToStrings(space.Net.AddrInfo()),
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
	pushDocuments(t, alice, space, "hm://"+aliceAccount)
	pushDocuments(t, alice, space, "hm://"+aliceAccount+aliceNotes.Path)

	list, err := space.RPC.DocumentsV3.ListCapabilities(ctx, &documents.ListCapabilitiesRequest{
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
