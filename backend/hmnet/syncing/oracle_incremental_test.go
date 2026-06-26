package syncing

import (
	"context"
	"testing"

	"seed/backend/blob"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

// TestMaintainRBSRIndex_IncrementalMatchesCollectBlobs is the fix's linchpin:
// driving MaintainRBSRIndex with blobs arriving the way live sync delivers them
// — out of order, capabilities and contacts trickling in after their targets —
// must converge the maintained rbsr_item set to exactly what collectBlobs
// computes, with NO shadow-verify re-materialization. It exercises all three
// edges the oracle previously deferred:
//
//   - late-arrival reverse edge: a Change indexed after its Ref's closure ran;
//   - agent-capability delegation closure, including a transitive delegation;
//   - inbound Contact-by-subject.
func TestMaintainRBSRIndex_IncrementalMatchesCollectBlobs(t *testing.T) {
	t.Parallel()
	db := storage.MakeTestDB(t)
	ctx := context.Background()

	alice := coretest.NewTester("alice").Account.Principal() // scope account + cap delegate + contact subject
	carol := coretest.NewTester("carol").Account.Principal() // authors the first capability
	bob := coretest.NewTester("bob").Account.Principal()     // authors the second capability + the contact

	base := "hm://" + alice.String()
	scope := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}

	maintain := func(conn *sqlite.Conn, ids ...int64) {
		require.NoError(t, MaintainRBSRIndex(conn, ids))
	}
	exec := func(conn *sqlite.Conn, q string, args ...any) {
		require.NoError(t, sqlitex.Exec(conn, q, nil, args...))
	}

	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		// Principals (author/delegate/subject reference public_keys.id).
		exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?)`, []byte(alice))
		exec(conn, `INSERT INTO public_keys (id, principal) VALUES (2, ?)`, []byte(carol))
		exec(conn, `INSERT INTO public_keys (id, principal) VALUES (3, ?)`, []byte(bob))

		exec(conn, `INSERT INTO resources (id, iri) VALUES (100, ?)`, base)
		exec(conn, `INSERT INTO resources (id, iri) VALUES (101, ?)`, base+"/doc")
		exec(conn, `INSERT INTO resources (id, iri) VALUES (102, ?)`, "hm://"+bob.String()) // contact creator's resource

		// Stage 0: account-root Ref + its Change, then materialize. The scope is
		// now a maintained, materialized {10,11} — as if discovered early.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (10, X'10', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author) VALUES (10, 'Ref', 100, 1)`)
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (11, X'11', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, author) VALUES (11, 'Change', 1)`)
		exec(conn, `INSERT INTO blob_links (source, type, target) VALUES (10, 'ref/head', 11)`)

		id, _, err := resolveScope(conn, scope, ProtocolVersionLegacy)
		require.NoError(t, err)
		require.NoError(t, materializeScope(conn, id, scope))

		// Stage 1: a second Ref arrives with no Change yet → closure is just {20}.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (20, X'20', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author) VALUES (20, 'Ref', 101, 1)`)
		maintain(conn, 20)

		// Stage 2: the Change for Ref 20 arrives LATE (after 20's closure ran).
		// Only the late-arrival reverse edge can place it: 20 (a member) links to it.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (21, X'21', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, author) VALUES (21, 'Change', 1)`)
		exec(conn, `INSERT INTO blob_links (source, type, target) VALUES (20, 'ref/head', 21)`)
		maintain(conn, 21)

		// Stage 3: an AGENT capability delegating to alice (who authored in-scope
		// blobs) → the delegation closure must pull it in.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (50, X'50', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, author, extra_attrs) VALUES (50, 'Capability', 2, '{"role":"AGENT","del":1}')`)
		maintain(conn, 50)

		// Stage 4: an AGENT capability delegating to the owner (author of cap 50,
		// now in scope) → transitive delegation must pull it in too.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (51, X'51', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, author, extra_attrs) VALUES (51, 'Capability', 3, '{"role":"AGENT","del":2}')`)
		maintain(conn, 51)

		// Stage 5: a Contact whose subject is alice, anchored to bob's resource →
		// the inbound Contact-by-subject edge must add it to alice's scope.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (60, X'60', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author, extra_attrs) VALUES (60, 'Contact', 102, 3, '{"subject":1}')`)
		maintain(conn, 60)

		return nil
	}))

	want := collectBlobIDs(t, db, scope)
	got := itemSetForScope(t, db, scopeIDFor(t, db, scope))
	require.Equal(t, want, got,
		"incrementally maintained set must equal collectBlobs without any re-materialization")
	// Guard the test itself actually built the interesting graph.
	require.Subset(t, want, map[int64]struct{}{
		10: {}, 11: {}, 20: {}, 21: {}, 50: {}, 51: {}, 60: {},
	}, "collectBlobs must include the full graph (Refs, late Change, both caps, contact)")
}

// scopeIDFor returns the rbsr_scope row id for a key (it must already exist).
func scopeIDFor(t *testing.T, db *sqlitex.Pool, dkey DiscoveryKey) int64 {
	t.Helper()
	var id int64
	require.NoError(t, db.WithTx(context.Background(), func(conn *sqlite.Conn) error {
		got, _, err := resolveScope(conn, dkey, ProtocolVersionLegacy)
		id = got
		return err
	}))
	return id
}
