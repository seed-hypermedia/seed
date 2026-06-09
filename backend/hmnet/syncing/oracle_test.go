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

// testSpace is a valid account principal used as the space segment of fixture
// IRIs. fillTables decodes the space as a principal, so it must be real.
func testSpace(t *testing.T) string {
	t.Helper()
	return coretest.NewTester("alice").Account.Principal().String()
}

// newMemDB opens a single-connection in-memory database for tests. The shared
// MakeTestDB/MakeTestMemoryDB helpers open a NumCPU-sized connection pool, which
// under this package's parallel suite intermittently returns SQLITE_READONLY on
// the first write in CI. A single-connection in-memory pool (the same config
// TestDBQueries uses) is stable.
func newMemDB(t *testing.T) *sqlitex.Pool {
	t.Helper()
	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, storage.InitSQLiteSchema(db))
	return db
}

func TestScopeCovers(t *testing.T) {
	t.Parallel()

	root := DiscoveryKey{IRI: "hm://s"}
	recursive := DiscoveryKey{IRI: "hm://s", Recursive: true}
	depthOne := DiscoveryKey{IRI: "hm://s", DepthOne: true}

	require.True(t, scopeCovers(root, "hm://s"), "exact match")
	require.False(t, scopeCovers(root, "hm://s/doc"), "exact scope excludes children")

	require.True(t, scopeCovers(recursive, "hm://s"), "recursive includes root")
	require.True(t, scopeCovers(recursive, "hm://s/doc"), "recursive includes child")
	require.True(t, scopeCovers(recursive, "hm://s/doc/sub"), "recursive includes grandchild")
	require.False(t, scopeCovers(recursive, "hm://other"), "recursive excludes unrelated")
	require.False(t, scopeCovers(recursive, "hm://s2"), "recursive must not prefix-match a sibling space")

	require.True(t, scopeCovers(depthOne, "hm://s"), "depthOne includes root")
	require.True(t, scopeCovers(depthOne, "hm://s/doc"), "depthOne includes direct child")
	require.False(t, scopeCovers(depthOne, "hm://s/doc/sub"), "depthOne excludes grandchild")
}

func TestScopeAllowsType(t *testing.T) {
	t.Parallel()

	require.True(t, scopeAllowsType(DiscoveryKey{}, "Ref"), "empty filter allows everything")
	s := DiscoveryKey{BlobTypes: BlobTypesString([]string{"Ref", "Change"})}
	require.True(t, scopeAllowsType(s, "Ref"))
	require.True(t, scopeAllowsType(s, "Change"))
	require.False(t, scopeAllowsType(s, "Comment"))
}

// oracleFixture seeds a small graph that exercises the resource-anchored +
// change-closure edges the oracle covers: a space root, two child docs and a
// grandchild, each with a Ref, where each Ref heads a chain of Changes.
//
//	<base>          (100) ── Ref 10 ──ref/head──> Change 11 ──change/dep──> Change 12
//	<base>/doc      (101) ── Ref 20 ──ref/head──> Change 21
//	<base>/doc/sub  (102) ── Ref 30 ──ref/head──> Change 31
//
// base is "hm://<principal>".
func oracleFixture(t *testing.T) (*sqlitex.Pool, string) {
	t.Helper()
	db := newMemDB(t)
	base := "hm://" + testSpace(t)

	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		for id, iri := range map[int]string{100: base, 101: base + "/doc", 102: base + "/doc/sub"} {
			if err := sqlitex.Exec(conn, `INSERT INTO resources (id, iri) VALUES (?, ?)`, nil, id, iri); err != nil {
				return err
			}
		}
		stmts := []string{
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (10, X'10', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, resource) VALUES (10, 'Ref', 100)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (11, X'11', 113, 1)`,
			`INSERT INTO structural_blobs (id, type) VALUES (11, 'Change')`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (12, X'12', 113, 1)`,
			`INSERT INTO structural_blobs (id, type) VALUES (12, 'Change')`,

			`INSERT INTO blobs (id, multihash, codec, size) VALUES (20, X'20', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, resource) VALUES (20, 'Ref', 101)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (21, X'21', 113, 1)`,
			`INSERT INTO structural_blobs (id, type) VALUES (21, 'Change')`,

			`INSERT INTO blobs (id, multihash, codec, size) VALUES (30, X'30', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, resource) VALUES (30, 'Ref', 102)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (31, X'31', 113, 1)`,
			`INSERT INTO structural_blobs (id, type) VALUES (31, 'Change')`,

			`INSERT INTO blob_links (source, type, target) VALUES (10, 'ref/head', 11)`,
			`INSERT INTO blob_links (source, type, target) VALUES (11, 'change/dep', 12)`,
			`INSERT INTO blob_links (source, type, target) VALUES (20, 'ref/head', 21)`,
			`INSERT INTO blob_links (source, type, target) VALUES (30, 'ref/head', 31)`,
		}
		for _, q := range stmts {
			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}
		return nil
	}))

	return db, base
}

func collectBlobIDs(t *testing.T, db *sqlitex.Pool, scope DiscoveryKey) map[int64]struct{} {
	t.Helper()
	out := map[int64]struct{}{}
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		if err := collectBlobs(conn, map[DiscoveryKey]struct{}{scope: {}}, false); err != nil {
			return err
		}
		return sqlitex.Exec(conn, `SELECT id FROM rbsr_blobs`, func(stmt *sqlite.Stmt) error {
			out[stmt.ColumnInt64(0)] = struct{}{}
			return nil
		})
	}))
	return out
}

// oracleUnionIDs applies the oracle to every blob in the DB and unions the IDs
// it reports the scope gains. If the oracle is sound and complete for the edges
// the fixture exercises, this must equal collectBlobs for the same scope.
func oracleUnionIDs(t *testing.T, db *sqlitex.Pool, scope DiscoveryKey) map[int64]struct{} {
	t.Helper()
	out := map[int64]struct{}{}
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		var ids []int64
		if err := sqlitex.Exec(conn, `SELECT id FROM structural_blobs`, func(stmt *sqlite.Stmt) error {
			ids = append(ids, stmt.ColumnInt64(0))
			return nil
		}); err != nil {
			return err
		}
		for _, id := range ids {
			inserts, _, err := affectedScopes(conn, id, []DiscoveryKey{scope})
			if err != nil {
				return err
			}
			for _, bid := range inserts[scope] {
				out[bid] = struct{}{}
			}
		}
		return nil
	}))
	return out
}

// TestOracle_DifferentialAgainstCollectBlobs is the linchpin: across a range of
// scope shapes, the union of the oracle's per-blob membership decisions must
// reproduce exactly what collectBlobs computes for that scope. Any seeding or
// closure error shows up as an inequality here.
func TestOracle_DifferentialAgainstCollectBlobs(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)

	cases := map[string]DiscoveryKey{
		"root exact":          {IRI: blob.IRI(base)},
		"root recursive":      {IRI: blob.IRI(base), Recursive: true},
		"root depthOne":       {IRI: blob.IRI(base), DepthOne: true},
		"child exact":         {IRI: blob.IRI(base + "/doc")},
		"child recursive":     {IRI: blob.IRI(base + "/doc"), Recursive: true},
		"refs only filter":    {IRI: blob.IRI(base), Recursive: true, BlobTypes: BlobTypesString([]string{"Ref"})},
		"refs+changes filter": {IRI: blob.IRI(base), Recursive: true, BlobTypes: BlobTypesString([]string{"Ref", "Change"})},
	}

	for name, scope := range cases {
		t.Run(name, func(t *testing.T) {
			want := collectBlobIDs(t, db, scope)
			got := oracleUnionIDs(t, db, scope)
			require.Equal(t, want, got, "oracle union must equal collectBlobs for scope %+v", scope)
		})
	}
}

// TestOracle_ChangeAloneDoesNotSeed verifies a Change (no resource) never seeds
// a scope on its own — it must arrive via the Ref that heads it.
func TestOracle_ChangeAloneDoesNotSeed(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)

	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		scope := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
		inserts, complete, err := affectedScopes(conn, 11, []DiscoveryKey{scope}) // Change blob.
		require.NoError(t, err)
		require.Empty(t, inserts, "a bare Change must not seed any scope")
		require.True(t, complete, "a Change with only change/dep links touches no uncovered edge")
		return nil
	}))
}

// TestOracle_RefSeedsItsChangeClosure verifies the dominant path: a freshly
// indexed Ref pulls in itself plus exactly the Changes it heads, transitively.
func TestOracle_RefSeedsItsChangeClosure(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)

	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		scope := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
		inserts, complete, err := affectedScopes(conn, 10, []DiscoveryKey{scope}) // Ref for base root.
		require.NoError(t, err)
		require.True(t, complete)
		require.ElementsMatch(t, []int64{10, 11, 12}, inserts[scope],
			"Ref 10 brings itself plus its transitive change closure 11->12")
		return nil
	}))
}

// TestOracle_UncoveredEdgesReportIncomplete verifies the soundness signal: a
// blob touching an edge the oracle does not expand incrementally must report
// complete=false so the caller re-materializes instead of trusting a partial
// answer.
func TestOracle_UncoveredEdgesReportIncomplete(t *testing.T) {
	t.Parallel()
	db := newMemDB(t)

	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		stmts := []string{
			`INSERT INTO resources (id, iri) VALUES (100, 'hm://s')`,
			`INSERT INTO resources (id, iri) VALUES (101, 'hm://s/doc')`,
			// A Contact (inbound-by-subject edge — not expanded incrementally).
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (40, X'40', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, resource, extra_attrs) VALUES (40, 'Contact', 100, '{"subject":1}')`,
			// A Capability (delegation closure — not expanded incrementally).
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (50, X'50', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, resource) VALUES (50, 'Capability', 100)`,
			// A Comment carrying a media link: the forward media closure covers
			// this, so it is reported complete.
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (60, X'60', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, resource) VALUES (60, 'Comment', 101)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (61, X'61', 113, 1)`,
			`INSERT INTO blob_links (source, type, target) VALUES (60, 'comment/Image', 61)`,
		}
		for _, q := range stmts {
			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}
		return nil
	}))

	scope := DiscoveryKey{IRI: "hm://s", Recursive: true}
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		// Contact (inbound-by-subject) and Capability (delegation) enter scopes
		// through edges the oracle does not expand forward → must flag incomplete.
		for _, id := range []int64{40, 50} {
			_, complete, err := affectedScopes(conn, id, []DiscoveryKey{scope})
			require.NoError(t, err)
			require.False(t, complete, "blob %d touches an uncovered edge and must report incomplete", id)
		}
		// A Comment with a media link is fully covered by the forward closure.
		inserts, complete, err := affectedScopes(conn, 60, []DiscoveryKey{scope})
		require.NoError(t, err)
		require.True(t, complete, "a media-bearing Comment is covered by the forward closure")
		require.ElementsMatch(t, []int64{60, 61}, inserts[scope], "Comment 60 brings itself plus its linked media 61")
		return nil
	}))
}
