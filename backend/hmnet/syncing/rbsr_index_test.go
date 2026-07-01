package syncing

import (
	"context"
	"testing"

	"seed/backend/blob"
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

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
