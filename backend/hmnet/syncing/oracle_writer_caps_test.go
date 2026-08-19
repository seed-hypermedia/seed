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

// TestMaintainRBSRIndex_WriterCapsAfterMaterialize is the unit-level guard for
// the field regression where write capabilities stopped syncing: WRITER
// capabilities (and a Contact) granted AFTER a subscriber-facing scope has been
// materialized must join the maintained set incrementally, with no
// re-materialization and no stale-marking. Before the fix, affectedScopes
// reported these blobs incomplete, the flag was discarded, and no targeted edge
// claimed the non-AGENT capability case — the inserts happened to be sound, but
// nothing enforced it, and any drift served short forever.
func TestMaintainRBSRIndex_WriterCapsAfterMaterialize(t *testing.T) {
	t.Parallel()
	db := storage.MakeTestDB(t)
	ctx := context.Background()

	alice := coretest.NewTester("alice").Account.Principal() // space owner, cap issuer
	bob := coretest.NewTester("bob").Account.Principal()     // WRITER delegate, contact creator

	base := "hm://" + alice.String()
	scope := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}

	maintain := func(conn *sqlite.Conn, ids ...int64) {
		require.NoError(t, MaintainRBSRIndex(conn, ids))
	}
	exec := func(conn *sqlite.Conn, q string, args ...any) {
		require.NoError(t, sqlitex.Exec(conn, q, nil, args...))
	}

	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?)`, []byte(alice))
		exec(conn, `INSERT INTO public_keys (id, principal) VALUES (2, ?)`, []byte(bob))

		exec(conn, `INSERT INTO resources (id, iri) VALUES (100, ?)`, base)
		exec(conn, `INSERT INTO resources (id, iri) VALUES (101, ?)`, base+"/doc")
		exec(conn, `INSERT INTO resources (id, iri) VALUES (102, ?)`, "hm://"+bob.String())

		// Stage 0: the home document, then materialize — the state a serving
		// site's scope is in once a subscriber has synced and gone quiet.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (10, X'10', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author) VALUES (10, 'Ref', 100, 1)`)
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (11, X'11', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, author) VALUES (11, 'Change', 1)`)
		exec(conn, `INSERT INTO blob_links (source, type, target) VALUES (10, 'ref/head', 11)`)

		id, _, err := resolveScope(conn, scope)
		require.NoError(t, err)
		require.NoError(t, materializeScope(conn, id, scope))

		// Stage 1: a root-path WRITER capability arrives late — anchored at the
		// space root, exactly where indexCapability puts a path-"" grant.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (40, X'40', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author, extra_attrs) VALUES (40, 'Capability', 100, 1, '{"role":"WRITER","del":2}')`)
		maintain(conn, 40)

		// Stage 2: a sub-document WRITER capability.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (41, X'41', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author, extra_attrs) VALUES (41, 'Capability', 101, 1, '{"role":"WRITER","del":2}')`)
		maintain(conn, 41)

		// Stage 3: a Contact whose subject is alice (the "Member" row), and one
		// with no subject at all — neither may trigger the coarse stale-mark.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (60, X'60', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author, extra_attrs) VALUES (60, 'Contact', 102, 2, '{"subject":1}')`)
		maintain(conn, 60)
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (61, X'61', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author) VALUES (61, 'Contact', 102, 2)`)
		maintain(conn, 61)

		return nil
	}))

	want := collectDownloadedBlobIDs(t, db, scope)
	got := itemSetForScope(t, db, scopeIDFor(t, db, scope))
	require.Equal(t, want, got,
		"late WRITER caps and contacts must reach the maintained set incrementally")
	require.Subset(t, got, map[int64]struct{}{40: {}, 41: {}, 60: {}},
		"both WRITER caps and the subject contact must be advertised")

	// The consume-or-stale-mark contract: every stage above is a case the
	// targeted edges provably cover, so nothing may have been demoted.
	require.True(t, scopeStillMaterialized(t, db, scopeIDFor(t, db, scope)),
		"covered cases must not trip the coarse stale-mark fail-safe")
}

// TestMaintainRBSRIndex_StaleStashMarkerStillAdvertised: a structural row
// coexisting with a stale stashed_blobs marker (crash windows, older builds,
// re-used blob ids) must still be advertised. The legacy fillTables path always
// advertised these; the oracle's delegation closure used to anti-join them
// away, producing permanent shadow-verify churn (the sweep re-adding what the
// closure refused) and starving peers whose own delegation chain needed the
// capability to complete.
func TestMaintainRBSRIndex_StaleStashMarkerStillAdvertised(t *testing.T) {
	t.Parallel()
	db := storage.MakeTestDB(t)
	ctx := context.Background()

	alice := coretest.NewTester("alice").Account.Principal()
	carol := coretest.NewTester("carol").Account.Principal()

	base := "hm://" + alice.String()
	scope := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}

	exec := func(conn *sqlite.Conn, q string, args ...any) {
		require.NoError(t, sqlitex.Exec(conn, q, nil, args...))
	}

	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		exec(conn, `INSERT INTO public_keys (id, principal) VALUES (1, ?)`, []byte(alice))
		exec(conn, `INSERT INTO public_keys (id, principal) VALUES (2, ?)`, []byte(carol))
		exec(conn, `INSERT INTO resources (id, iri) VALUES (100, ?)`, base)

		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (10, X'10', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, resource, author) VALUES (10, 'Ref', 100, 1)`)

		id, _, err := resolveScope(conn, scope)
		require.NoError(t, err)
		require.NoError(t, materializeScope(conn, id, scope))

		// An AGENT capability with a stale stash marker: structural rows exist
		// (so it was validly indexed at some point) AND a stashed_blobs row
		// lingers. The delegation closure must still add it.
		exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (50, X'50', 113, 1)`)
		exec(conn, `INSERT INTO structural_blobs (id, type, author, extra_attrs) VALUES (50, 'Capability', 2, '{"role":"AGENT","del":1}')`)
		exec(conn, `INSERT INTO stashed_blobs (id, reason, extra_attrs) VALUES (50, 'permission-denied', '{}')`)
		require.NoError(t, MaintainRBSRIndex(conn, []int64{50}))
		return nil
	}))

	got := itemSetForScope(t, db, scopeIDFor(t, db, scope))
	require.Contains(t, got, int64(50),
		"a structural capability with a stale stash marker must still be advertised")

	// And the maintained set must equal the fresh set — otherwise every sweep
	// pass flaps between adding and losing the blob.
	want := collectDownloadedBlobIDs(t, db, scope)
	require.Equal(t, want, got,
		"maintained and fresh sets must agree on stash-marker blobs, or shadow-verify churns forever")
}

// scopeStillMaterialized reports the materialized flag of one rbsr_scope row.
func scopeStillMaterialized(t *testing.T, db *sqlitex.Pool, scopeID int64) bool {
	t.Helper()
	var m bool
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `SELECT materialized FROM rbsr_scope WHERE id = ?`, func(stmt *sqlite.Stmt) error {
			m = stmt.ColumnInt(0) != 0
			return nil
		}, scopeID)
	}))
	return m
}
