package keylinesqlite

import (
	"path/filepath"
	"strings"
	"testing"

	"seed/backend/keyline"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	db := OpenTestDB(t, filepath.Join(t.TempDir(), "authority.db"), 4)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return &Store{Pool: db}
}

func TestSQLiteNodeInterning(t *testing.T) {
	store := newTestStore(t)
	ctx := t.Context()
	conn, release, err := store.Pool.WriteConn(ctx)
	require.NoError(t, err)
	defer release()
	require.NoError(t, sqlitex.Exec(conn, dqb.Str(`PRAGMA foreign_keys = ON`)(), nil))
	storeTestBlobs(t, conn, 1, 2, 3, 4, 5, 6, 7, 8, 9, 99)
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		tx := Tx{Conn: conn}
		batch := keyline.Batch{
			Delegations: []keyline.Delegation{
				{ID: "shared", Issuer: "shared", Audience: "peer", Subject: "shared", Power: keyline.Admin, BlobID: 1},
				{ID: "d2", Issuer: "peer", Audience: "shared", Subject: "subject-only", Power: keyline.Read, BlobID: 2},
			},
			Revocations: []keyline.Revocation{
				{ID: "r1", Issuer: "revoker-only", Target: "missing target", BlobID: 3},
				{ID: "r2", Issuer: "shared", Target: "shared", BlobID: 4},
			},
		}
		changed, err := tx.Apply(ctx, batch)
		require.NoError(t, err)
		require.True(t, changed)
		type nodeRow struct {
			id       int64
			blobID   int64
			blobType sqlite.ColumnType
		}

		readNodes := func() map[keyline.Node]nodeRow {
			nodes := make(map[keyline.Node]nodeRow)
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`SELECT name, id, blob_id FROM keyline_nodes`)(), func(row *sqlite.Stmt) error {
				nodes[keyline.Node(row.ColumnText(0))] = nodeRow{row.ColumnInt64(1), row.ColumnInt64(2), row.ColumnType(2)}
				return nil
			}))
			return nodes
		}
		readRecords := func() []keyline.Record {
			var records []keyline.Record

			for record, err := range tx.Records(ctx) {
				require.NoError(t, err)
				records = append(records, record)
			}

			return records
		}
		nodes := readNodes()
		require.Len(t, nodes, 4, "intern every referenced node once, but not fact IDs or missing targets")
		for _, name := range []keyline.Node{"shared", "peer", "subject-only", "revoker-only"} {
			require.Contains(t, nodes, name)
			require.Positive(t, nodes[name].id)
			require.Equal(t, sqlite.SQLITE_NULL, nodes[name].blobType)
			n, found, err := tx.Node(ctx, name)
			require.NoError(t, err)
			require.False(t, found)
			require.Zero(t, n)
		}

		for _, d := range batch.Delegations {
			var refs [][3]int64

			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`SELECT issuer, audience, subject FROM keyline_delegations WHERE id = ?`)(), func(row *sqlite.Stmt) error {
				refs = append(refs, [3]int64{row.ColumnInt64(0), row.ColumnInt64(1), row.ColumnInt64(2)})
				return nil
			}, d.ID))
			require.Equal(t, [][3]int64{{nodes[d.Issuer].id, nodes[d.Audience].id, nodes[d.Subject].id}}, refs)
		}

		for _, r := range batch.Revocations {
			issuer, err := sqlitex.QueryOne[int64](conn, dqb.Str(`SELECT issuer FROM keyline_revocations WHERE id = ?`)(), r.ID)
			require.NoError(t, err)
			require.Equal(t, nodes[r.Issuer].id, issuer, "reuse IDs across delegation and revocation roles")
		}

		want := []keyline.Record{batch.Delegations[1], batch.Delegations[0], batch.Revocations[0], batch.Revocations[1]}
		require.Equal(t, want, readRecords(), "intern-only nodes are not mention records")
		changed, err = tx.Apply(ctx, batch)
		require.NoError(t, err)
		require.False(t, changed)
		require.Equal(t, nodes, readNodes(), "replay preserves IDs and NULL provenance")

		// A node and fact may share their public ID. Late provenance fills the
		// existing interned row without replacing its integer ID or references.
		batch.Nodes = []keyline.NodeRecord{{ID: "shared", BlobID: 5, Timestamp: 10, BlobKey: "later-blob"}}
		changed, err = tx.Apply(ctx, batch)
		require.NoError(t, err)
		require.True(t, changed)
		nodes["shared"] = nodeRow{nodes["shared"].id, 5, sqlite.SQLITE_INTEGER}
		require.Equal(t, nodes, readNodes())
		want = append([]keyline.Record{batch.Nodes[0]}, want...)
		require.Equal(t, want, readRecords())
		changed, err = tx.Apply(ctx, batch)
		require.NoError(t, err)
		require.False(t, changed)

		// Earlier mentions update the same row, preserving all integer references.
		batch.Nodes = []keyline.NodeRecord{{ID: "shared", BlobID: 8, Timestamp: -10, BlobKey: "earlier-blob"}}
		changed, err = tx.Apply(ctx, batch)
		require.NoError(t, err)
		require.True(t, changed)
		nodes["shared"] = nodeRow{nodes["shared"].id, 8, sqlite.SQLITE_INTEGER}
		want[0] = batch.Nodes[0]
		require.Equal(t, nodes, readNodes(), "provenance improvements preserve integer IDs")
		require.Equal(t, want, readRecords(), "joins still resolve the original references")
		n, found, err := tx.Node(ctx, "shared")
		require.NoError(t, err)
		require.True(t, found)
		require.Equal(t, batch.Nodes[0], n)
		changed, err = tx.Apply(ctx, batch)
		require.NoError(t, err)
		require.False(t, changed)

		for _, failed := range []keyline.Batch{
			{Nodes: []keyline.NodeRecord{{ID: "peer", BlobID: 6, BlobKey: "peer-blob"}, {ID: "shared", BlobID: 99, Timestamp: -10, BlobKey: "earlier-blob"}}},
			{
				Nodes:       []keyline.NodeRecord{{ID: "peer", BlobID: 6, BlobKey: "peer-blob"}},
				Delegations: []keyline.Delegation{{ID: "shared", Issuer: "lost issuer", Audience: "lost audience", Subject: "lost subject", Power: keyline.Read, BlobID: 7}},
			},
			{
				Nodes: []keyline.NodeRecord{{ID: "peer", BlobID: 6, BlobKey: "peer-blob"}},
				Revocations: []keyline.Revocation{
					{ID: "fresh", Issuer: "lost revoker", Target: "missing", BlobID: 7},
					{ID: "r2", Issuer: "changed revoker", Target: "shared", BlobID: 4},
				},
			},
			{
				Nodes:       []keyline.NodeRecord{{ID: "shared", BlobID: 9, Timestamp: -20, BlobKey: "rejected-earliest"}},
				Delegations: []keyline.Delegation{{ID: "fresh", Issuer: "lost issuer", Audience: "lost audience", Subject: "lost subject", Power: keyline.Read, BlobID: 7}},
				Revocations: []keyline.Revocation{{ID: "shared", Issuer: "shared", Target: "missing", BlobID: 8}},
			},
		} {
			changed, err := tx.Apply(ctx, failed)
			require.ErrorIs(t, err, keyline.ErrConflict)
			require.False(t, changed)
			require.False(t, conn.GetAutocommit())
			require.Equal(t, nodes, readNodes(), "rollback removes new intern rows and restores NULL provenance")
			require.Equal(t, want, readRecords(), "keep the caller's preceding records")
		}

		return nil
	}))
}

func TestSQLiteEnumerationQueryPlans(t *testing.T) {
	store := newTestStore(t)
	require.NoError(t, store.Pool.Query(t.Context(), func(conn *sqlite.Conn) error {
		for _, q := range []struct {
			query dqb.LazyQuery
			args  []any
			plans []string
			sort  bool
		}{
			{sqliteBySubject, []any{"doc"}, []string{"SEARCH d USING INDEX keyline_outgoing (subject=?)"}, false},
			{sqliteToAudience, []any{"doc", "alice"}, []string{
				"SEARCH d USING INDEX keyline_outgoing (subject=?)",
				"SEARCH d USING INDEX keyline_delegations_by_audience (audience=? AND subject=?)",
			}, false},
			// Either index holds every subject; Subjects sorts resolved names anyway.
			{sqliteSubjects, nil, []string{
				"SCAN d USING COVERING INDEX keyline_outgoing",
				"SCAN d USING COVERING INDEX keyline_delegations_by_audience",
			}, true},
			{sqliteAllNodes, nil, []string{"SCAN keyline_nodes USING INDEX sqlite_autoindex_keyline_nodes_1"}, false},
			{sqliteAllDelegations, nil, []string{"SCAN d USING INDEX sqlite_autoindex_keyline_delegations_1"}, false},
			{sqliteAllRevocations, nil, []string{"SCAN r USING INDEX sqlite_autoindex_keyline_revocations_1"}, false},
		} {
			var plans []string

			require.NoError(t, sqlitex.Exec(conn, dqb.Str("EXPLAIN QUERY PLAN "+q.query())(), func(row *sqlite.Stmt) error {
				plans = append(plans, row.ColumnText(3))
				return nil
			}, q.args...))
			require.NotEmpty(t, plans)
			require.Contains(t, q.plans, plans[0], q.query())
			for _, plan := range plans[1:] {
				// Resolving names adds indexed node lookups and scalar subqueries,
				// never another table scan. Only Subjects may sort resolved names;
				// Records must stream every group directly from its ordered index.
				require.NotContains(t, plan, "SCAN", q.query())

				if q.sort && strings.HasPrefix(plan, "USE TEMP B-TREE") {
					continue
				}

				require.True(t, strings.HasPrefix(plan, "SEARCH") || strings.HasPrefix(plan, "SCALAR SUBQUERY"), plan)
			}
		}

		return nil
	}))
}

func TestSQLiteSchemaConstraints(t *testing.T) {
	store := newTestStore(t)
	conn, release, err := store.Pool.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()
	require.NoError(t, sqlitex.Exec(conn, dqb.Str(`PRAGMA foreign_keys = ON`)(), nil))
	storeTestBlobs(t, conn, 1, 2)
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		for _, values := range [][]any{
			{"", 1, 0, "blob"}, {"n", 0, 0, "blob"}, {"n", -1, 0, "blob"},
			{"n", 1, 0, ""}, {"n", 1, 1.5, "blob"}, {"n", 1, 0, []byte("blob")},
			{"n", 1, nil, nil}, {"n", nil, 0, nil}, {"n", nil, nil, "blob"},
			{"n", nil, 0, "blob"}, {"n", 1, nil, "blob"}, {"n", 1, 0, nil},
			{"n", 99, 0, "blob"},
		} {
			require.Error(t, sqlitex.Exec(conn, sqliteInsertNode(), nil, values...), "%v", values)
		}

		require.NoError(t, sqlitex.Exec(conn, dqb.Str(`INSERT INTO keyline_nodes(id, name) VALUES (1, 'i'), (2, 'a'), (3, 's')`)(), nil))
		for _, ts := range []int64{0, -1, 1} {
			require.NoError(t, sqlitex.Exec(conn, sqliteInsertNode(), nil, "mention", 1, ts, "blob"))
		}

		require.Error(t, sqlitex.Exec(conn, dqb.Str(`INSERT INTO keyline_nodes(name) VALUES ('i')`)(), nil), "names are unique")
		require.Error(t, sqlitex.Exec(conn, sqliteInternNode(), nil, ""))
		require.Error(t, sqlitex.Exec(conn, sqliteInternNode(), nil, nil))
		require.NoError(t, sqlitex.Exec(conn, sqliteInsertDelegation(), nil, "valid", 1, 2, 3, 2, 1))
		require.NoError(t, sqlitex.Exec(conn, sqliteInsertDelegation(), nil, "implied", 1, 2, 3, 2, nil))
		require.NoError(t, sqlitex.Exec(conn, sqliteInsertRevocation(), nil, "valid", 1, "missing target", 2))
		for _, values := range [][]any{
			{"", 1, 2, 3, 1, 1}, {"d", "i", 2, 3, 1, 1},
			{"d", 1, "a", 3, 1, 1}, {"d", 1, 2, "s", 1, 1},
			{"d", 99, 2, 3, 1, 1}, {"d", 1, 99, 3, 1, 1}, {"d", 1, 2, 99, 1, 1},
			{"d", 1, 2, 3, 0, 1}, {"d", 1, 2, 3, 5, 1}, {"d", 1, 2, 3, 257, 1}, {"d", 1, 2, 3, -1, 1},
			{"d", 1, 2, 3, 1, 0}, {"d", 1, 2, 3, 1, -1}, {"d", 1, 2, 3, 1, 99},
			{"d", 1, 2, 3, 1.5, 1}, {"d", 1, 2, 3, 1, 1.5},
			{"d", 1, 2, 3, "", 1}, {"d", 1, 2, 3, "r", 1},
			{"d", 1, 2, 3, "read", 1}, {"d", 1, 2, 3, []byte("r"), 1},
			{nil, 1, 2, 3, 1, 1}, {"d", nil, 2, 3, 1, 1},
			{"d", 1, nil, 3, 1, 1}, {"d", 1, 2, nil, 1, 1},
			{"d", 1, 2, 3, nil, 1},
		} {
			require.Error(t, sqlitex.Exec(conn, sqliteInsertDelegation(), nil, values...), "%v", values)
		}

		for _, values := range [][]any{
			{"", 1, "t", 1}, {"r", "i", "t", 1}, {"r", 99, "t", 1}, {"r", 1, "", 1}, {"r", 1, "t", 0}, {"r", 1, "t", 99},
			{nil, 1, "t", 1}, {"r", nil, "t", 1}, {"r", 1, nil, 1}, {"r", 1, "t", nil},
		} {
			require.Error(t, sqlitex.Exec(conn, sqliteInsertRevocation(), nil, values...), "%v", values)
		}

		return nil
	}))
}

func TestSQLitePowerEncoding(t *testing.T) {
	store := newTestStore(t)
	for _, tc := range []struct {
		power  keyline.Power
		stored string
	}{
		{keyline.Sync, "integer:1"}, {keyline.Read, "integer:2"}, {keyline.Write, "integer:3"}, {keyline.Admin, "integer:4"},
	} {
		t.Run(tc.power.String(), func(t *testing.T) {
			ctx := t.Context()
			require.NoError(t, store.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
				tx := Tx{Conn: conn}
				d := keyline.Delegation{ID: keyline.ID(tc.power.String()), Issuer: "doc", Audience: "alice", Subject: "doc", Power: tc.power, BlobID: 1}
				batch := keyline.Batch{Delegations: []keyline.Delegation{d}}
				changed, err := tx.Apply(ctx, batch)
				require.NoError(t, err)
				require.True(t, changed)
				stored, err := sqlitex.QueryOne[string](conn, dqb.Str(`SELECT typeof(power) || ':' || power FROM keyline_delegations WHERE id = ?`)(), d.ID)
				require.NoError(t, err)
				require.Equal(t, tc.stored, stored)
				got, found, err := tx.Delegation(ctx, d.ID)
				require.NoError(t, err)
				require.True(t, found)
				require.Equal(t, d, got)
				changed, err = tx.Apply(ctx, batch)
				require.NoError(t, err)
				require.False(t, changed)
				return nil
			}))
		})
	}
}

func TestSQLiteIndexedQueries(t *testing.T) {
	store := newTestStore(t)
	require.NoError(t, store.Pool.Query(t.Context(), func(conn *sqlite.Conn) error {
		for _, q := range []struct {
			query dqb.LazyQuery
			args  []any
			index string
		}{
			{sqliteNode, []any{"n"}, "sqlite_autoindex_keyline_nodes_1"},
			{sqliteNodeID, []any{"n"}, "sqlite_autoindex_keyline_nodes_1"},
			{sqliteDelegation, []any{"d"}, "sqlite_autoindex_keyline_delegations_1"},
			{sqliteRevocation, []any{"r"}, "sqlite_autoindex_keyline_revocations_1"},
			{sqliteOutgoing, []any{"doc", "doc"}, "keyline_outgoing"},
			{sqliteTargeting, []any{"d"}, "keyline_targeting"},
		} {
			var plans []string

			require.NoError(t, sqlitex.Exec(conn, dqb.Str("EXPLAIN QUERY PLAN "+q.query())(), func(row *sqlite.Stmt) error {
				plans = append(plans, row.ColumnText(3))
				return nil
			}, q.args...))
			require.NotEmpty(t, plans)
			require.Contains(t, plans[0], "SEARCH")
			require.Contains(t, plans[0], q.index)
			for _, plan := range plans {
				require.NotContains(t, plan, "SCAN")
				require.True(t, strings.HasPrefix(plan, "SEARCH") || strings.HasPrefix(plan, "SCALAR SUBQUERY"), plan)
			}
		}

		return nil
	}))
}
