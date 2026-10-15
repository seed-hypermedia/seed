package syncing

import (
	"context"
	"testing"

	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/util/colx"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
)

func fingerprintOf(t *testing.T, store *authorizedStore) rbsr.Fingerprint {
	t.Helper()
	s, err := rbsr.NewSession(store, 50000)
	require.NoError(t, err)
	fp, err := s.Fingerprint(0, store.Size())
	require.NoError(t, err)
	return fp
}

// TestRbsrIndex_BuildMatchesLoadRBSRStore is the task-3 linchpin: materializing
// a scope and building the tree-backed store from persisted rows must produce a
// store byte-identical (size + fingerprint) to the legacy loadRBSRStore rebuild
// for the same scope. Under the legacy protocol no canonicalization applies, so
// the two must match exactly.
func TestRbsrIndex_BuildMatchesLoadRBSRStore(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	dkey := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
	ctx := context.Background()

	want := newAuthorizedStore()
	require.NoError(t, db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, map[DiscoveryKey]struct{}{dkey: {}}, want)
	}))
	require.NoError(t, want.Seal())

	got := newAuthorizedTreeStore()
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		id, materialized, err := resolveScope(conn, dkey)
		if err != nil {
			return err
		}
		require.False(t, materialized, "freshly resolved scope must be unmaterialized")
		if err := materializeScope(conn, id, dkey); err != nil {
			return err
		}
		return buildStoreFromScopes(conn, []int64{id}, got)
	}))
	require.NoError(t, got.Seal())

	require.Equal(t, want.Size(), got.Size(), "persistent store size must match loadRBSRStore")
	require.Equal(t, fingerprintOf(t, want), fingerprintOf(t, got), "fingerprints must match")
}

func itemSetForScope(t *testing.T, db *sqlitex.Pool, scopeID int64) map[int64]struct{} {
	t.Helper()
	out := map[int64]struct{}{}
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `SELECT blob FROM rbsr_item WHERE scope = ?`, func(stmt *sqlite.Stmt) error {
			out[stmt.ColumnInt64(0)] = struct{}{}
			return nil
		}, scopeID)
	}))
	return out
}

// TestRbsrIndex_IncrementalMaintenanceMatchesCollectBlobs is the task-5
// linchpin: after a scope is materialized and then new blobs are indexed
// through the maintenance hook, the scope's persisted set must equal a fresh
// collectBlobs — i.e. the oracle kept it current without re-materializing.
func TestRbsrIndex_IncrementalMaintenanceMatchesCollectBlobs(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	dkey := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
	ctx := context.Background()

	var scopeID int64
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		id, _, err := resolveScope(conn, dkey)
		if err != nil {
			return err
		}
		scopeID = id
		return materializeScope(conn, id, dkey)
	}))

	// Index a new document under the scope: a Ref heading a new Change.
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		stmts := []string{
			`INSERT INTO resources (id, iri) VALUES (200, '` + base + `/newdoc')`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (70, X'70', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, resource) VALUES (70, 'Ref', 200)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (71, X'71', 113, 1)`,
			`INSERT INTO structural_blobs (id, type) VALUES (71, 'Change')`,
			`INSERT INTO blob_links (source, type, target) VALUES (70, 'ref/head', 71)`,
		}
		for _, q := range stmts {
			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}
		// Drive the maintenance hook with the freshly "indexed" blob ids.
		return MaintainRBSRIndex(conn, []int64{70, 71})
	}))

	maintained := itemSetForScope(t, db, scopeID)
	fresh := collectBlobIDs(t, db, dkey)
	require.Equal(t, fresh, maintained, "incrementally maintained set must equal a fresh collectBlobs")
}

// TestRbsrIndex_ResolveScopeIdempotent verifies the scope registry: resolving
// the same key twice returns the same id and reflects materialization state.
func TestRbsrIndex_ResolveScopeIdempotent(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	dkey := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
	ctx := context.Background()

	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		id1, mat1, err := resolveScope(conn, dkey)
		require.NoError(t, err)
		require.False(t, mat1)

		id2, _, err := resolveScope(conn, dkey)
		require.NoError(t, err)
		require.Equal(t, id1, id2, "same key resolves to same scope id")

		// A different kind for the same IRI is a distinct scope; the protocol
		// version is intentionally NOT part of the identity anymore.
		id3, _, err := resolveScope(conn, DiscoveryKey{IRI: blob.IRI(base), DepthOne: true})
		require.NoError(t, err)
		require.NotEqual(t, id1, id3, "scope kind is part of the scope identity")

		require.NoError(t, materializeScope(conn, id1, dkey))
		_, matAfter, err := resolveScope(conn, dkey)
		require.NoError(t, err)
		require.True(t, matAfter, "scope is materialized after materializeScope")
		return nil
	}))
}

// TestLoadIndexedScopes_ClientPathMatchesLegacy covers the client store build:
// the shared three-phase load must produce the same store as the legacy
// per-call rebuild — both on the cold (materializing) first call and the warm
// (read-only) second one — and a request-carried Version must not matter,
// since scope identity ignores versions exactly like fillTables does.
func TestLoadIndexedScopes_ClientPathMatchesLegacy(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	ctx := context.Background()

	versioned := DiscoveryKey{IRI: blob.IRI(base), Version: "bafyfakeversion", Recursive: true}

	want := newAuthorizedStore()
	require.NoError(t, db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return loadRBSRStore(conn, map[DiscoveryKey]struct{}{versioned: {}}, want)
	}))
	require.NoError(t, want.Seal())

	indexKey := versioned
	indexKey.Version = ""
	for _, phase := range []string{"cold", "warm"} {
		got := newAuthorizedTreeStore()
		_, err := loadIndexedScopes(ctx, db, colx.HashSet[DiscoveryKey]{indexKey: {}}, got)
		require.NoError(t, err, phase)
		require.NoError(t, got.Seal(), phase)
		require.Equal(t, want.Size(), got.Size(), "%s: size must match legacy", phase)
		require.Equal(t, fingerprintOf(t, want), fingerprintOf(t, got), "%s: fingerprint must match legacy", phase)
	}

	// Exotic type filters have no maintained scope kind and must fall back.
	exotic := DiscoveryKey{IRI: blob.IRI(base), BlobTypes: "Comment"}
	_, err := loadIndexedScopes(ctx, db, colx.HashSet[DiscoveryKey]{exotic: {}}, newAuthorizedTreeStore())
	require.ErrorIs(t, err, errScopeNotRepresentable)
}

// TestRbsrIndex_PrivateVisibilityFollowsItemsNotRows pins the loader end of the
// visibility fix: the store query returns rows ordered one way (it used to sort
// by timestamp then multihash) while the stores order items by timestamp then
// CID bytes, and the two disagree for blobs sharing a timestamp but not a
// codec — every media blob of a private document, since non-structural blobs
// all sit at timestamp 0. Whatever order the rows arrive in, an unauthorized
// peer must see every public blob and none of the private ones.
func TestRbsrIndex_PrivateVisibilityFollowsItemsNotRows(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	dkey := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
	scopeID := materializeFixtureScope(t, db, dkey)
	space := generatePrincipal(t)
	ctx := context.Background()

	// Two private media blobs with no structural row: a raw one (codec 0x55)
	// whose multihash sorts after the dag-pb one's (codec 0x70), so the
	// multihash order is the reverse of the CID-key order.
	rawHash, dagHash := []byte{0x12, 0x00}, []byte{0x11, 0x00}
	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, `INSERT INTO public_keys (principal) VALUES (?)`, nil, []byte(space)); err != nil {
			return err
		}

		spaceID := conn.LastInsertRowID()
		for _, q := range []struct {
			sql  string
			args []any
		}{
			{`INSERT INTO blobs (id, multihash, codec, size) VALUES (80, ?, 85, 1)`, []any{rawHash}},
			{`INSERT INTO blobs (id, multihash, codec, size) VALUES (81, ?, 112, 1)`, []any{dagHash}},
			{`INSERT INTO blob_visibility (id, space) VALUES (80, ?)`, []any{spaceID}},
			{`INSERT INTO blob_visibility (id, space) VALUES (81, ?)`, []any{spaceID}},
			{`INSERT INTO rbsr_item (scope, blob) VALUES (?, 80)`, []any{scopeID}},
			{`INSERT INTO rbsr_item (scope, blob) VALUES (?, 81)`, []any{scopeID}},
		} {
			if err := sqlitex.Exec(conn, q.sql, nil, q.args...); err != nil {
				return err
			}
		}

		return nil
	}))

	private := map[string]bool{
		cid.NewCidV1(85, rawHash).KeyString():  true,
		cid.NewCidV1(112, dagHash).KeyString(): true,
	}

	for _, backend := range []struct {
		name string
		new  func() *authorizedStore
	}{
		{"slice", newAuthorizedStore},
		{"tree", newAuthorizedTreeStore},
	} {
		t.Run(backend.name, func(t *testing.T) {
			store := backend.new()
			require.NoError(t, db.WithSave(ctx, func(conn *sqlite.Conn) error {
				return buildStoreFromScopes(conn, []int64{scopeID}, store)
			}))
			require.NoError(t, store.Seal())

			values := func(st *authorizedStore) map[string]bool {
				out := map[string]bool{}
				require.NoError(t, st.ForEach(0, st.Size(), func(_ int, item rbsr.Item) bool {
					out[string(item.Value)] = true
					return true
				}))
				return out
			}

			unauthorized := values(store.WithFilter(nil))
			require.Len(t, unauthorized, store.Size()-len(private), "an unauthorized peer must see every public blob")
			for key := range private {
				require.NotContains(t, unauthorized, key, "a private blob must never be advertised to an unauthorized peer")
			}

			authorized := values(store.WithFilter([]core.Principal{space}))
			require.Len(t, authorized, store.Size())
			for key := range private {
				require.Contains(t, authorized, key)
			}
		})
	}
}
