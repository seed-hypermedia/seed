package storage_test

import (
	"fmt"
	"slices"
	"testing"

	"seed/backend/keyline/keylinesqlite"
	"seed/backend/storage"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/sqlitegen"

	"github.com/stretchr/testify/require"
)

// Snapshot package-level queries before other storage tests register queries
// against their own temporary tables in dqb.GlobalQueries.
var schemaQueries = dqb.GlobalQueries

func TestSchemaKeylineCompatibility(t *testing.T) {
	db := storage.MakeTestMemoryDB(t)
	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		objects, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM sqlite_schema WHERE name GLOB 'keyline_*'")
		require.NoError(t, err)
		require.Equal(t, 10, objects, "the Seed schema must initialize Keyline and its membership cache")
		require.NoError(t, keylinesqlite.Init(t.Context(), conn))
		return nil
	}))
}

func TestSchemaQueries(t *testing.T) {
	db := storage.MakeTestMemoryDB(t)
	// Importing Keyline must leave its ordinary queries testable without
	// registering CREATE statements that conflict with the existing schema.
	require.NoError(t, schemaQueries.Test(db))
}

// Reindex truncates derived tables with foreign keys off, which is only safe
// while no permanent table references a derived one: its rows would be left
// pointing at nothing, without the cascade enforcement would have applied.
func TestDerivedTablesReferencedOnlyByDerivedTables(t *testing.T) {
	kinds := make(map[string]storage.TableKind)
	for _, spec := range storage.TableSpecs() {
		kinds[spec.Name] = spec.Kind
	}

	db := storage.MakeTestMemoryDB(t)
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	var checked int

	require.NoError(t, sqlitex.Exec(conn, `
		SELECT m.name, fk."table"
		FROM sqlite_schema m, pragma_foreign_key_list(m.name) fk
		WHERE m.type = 'table'
	`, func(stmt *sqlite.Stmt) error {
		child, parent := stmt.ColumnText(0), stmt.ColumnText(1)
		if kinds[parent] == storage.TableKindDerived {
			checked++
			require.Equal(t, storage.TableKindDerived, kinds[child], "%s references derived table %s", child, parent)
		}

		return nil
	}))
	require.Positive(t, checked)
}

// Keyline's tables are derived, and Keyline must reinitialize on top of them
// once reindex has emptied them.
func TestKeylineReindexTables(t *testing.T) {
	keyline := []string{storage.T_KeylineNodes, storage.T_KeylineDelegations, storage.T_KeylineRevocations, storage.T_KeylineMembers}
	specs := storage.TableSpecs()
	for _, name := range keyline {
		idx := slices.IndexFunc(specs, func(spec storage.TableSpec) bool {
			return spec.Name == name
		})
		require.NotEqual(t, -1, idx)
		require.Equal(t, storage.TableKindDerived, specs[idx].Kind)
	}

	db := storage.MakeTestMemoryDB(t)
	conn, release, err := db.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()

	require.NoError(t, sqlitex.ExecScript(conn, `
		INSERT INTO keyline_nodes (id, name, blob_id, ts, blob_key)
		VALUES (1, 'opaque-subject', 1, 0, 'opaque-blob'), (2, 'opaque-member', NULL, NULL, NULL);
		INSERT INTO keyline_delegations (id, issuer, audience, subject, power, blob_id)
		VALUES ('delegation', 1, 2, 1, 'a', 2);
		INSERT INTO keyline_revocations (id, issuer, target, blob_id)
		VALUES ('revocation', 1, 'delegation', 3);
		INSERT INTO keyline_members (subject, member, power) VALUES (1, 2, 'a');
	`))

	// Reindex empties derived tables with foreign keys off, in no particular order.
	require.NoError(t, sqlitex.ExecTransient(conn, "PRAGMA foreign_keys = OFF", nil))
	for _, name := range keyline {
		require.NoError(t, sqlitex.ExecTransient(conn, "DELETE FROM "+name, nil))
	}

	require.NoError(t, sqlitex.ExecTransient(conn, "PRAGMA foreign_keys = ON", nil))

	require.NoError(t, keylinesqlite.Init(t.Context(), conn))
}

func TestKeylinePowerConstraints(t *testing.T) {
	for table, insert := range map[string]string{
		storage.T_KeylineDelegations: "INSERT INTO keyline_delegations (id, issuer, audience, subject, power, blob_id) VALUES (?, 1, 2, 1, ?, 1)",
		storage.T_KeylineMembers:     "INSERT INTO keyline_members (subject, member, power) VALUES (1, ?, ?)",
	} {
		t.Run(table, func(t *testing.T) {
			db := storage.MakeTestMemoryDB(t)
			conn, release, err := db.WriteConn(t.Context())
			require.NoError(t, err)
			defer release()

			require.NoError(t, sqlitex.ExecScript(conn, `
				INSERT INTO keyline_nodes (id, name) VALUES
					(1, 'subject'), (2, 's'), (3, 'r'), (4, 'w'), (5, 'a'), (6, 'invalid');
			`))
			for i, power := range []string{"s", "r", "w", "a"} {
				require.NoError(t, sqlitex.Exec(conn, insert, nil, i+2, power))
			}

			count, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM "+table+" WHERE typeof(power) = 'text'")
			require.NoError(t, err)
			require.Equal(t, 4, count)

			for _, power := range []any{
				nil, -1, 0, 1, 2, 3, 4, 5,
				"1", "2", "3", "4", "", " ", " a", "a ", "a\n", "A", "admin", "x", []byte("a"),
			} {
				require.Error(t, sqlitex.Exec(conn, insert, nil, 6, power), "power %v (%T)", power, power)
			}
		})
	}
}

func TestKeylineMembersConstraints(t *testing.T) {
	db := storage.MakeTestMemoryDB(t)
	conn, release, err := db.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()

	const insert = "INSERT INTO keyline_members (subject, member, power) VALUES (?, ?, ?)"

	require.NoError(t, sqlitex.Exec(conn, "INSERT INTO keyline_nodes (id, name) VALUES (1, 'subject'), (2, 'member')", nil))
	require.NoError(t, sqlitex.Exec(conn, insert, nil, 1, 2, "s"))

	for _, args := range [][]any{
		{nil, 2, "s"},
		{1, nil, "s"},
		{1, 2, "a"}, // Duplicate membership even with a different power.
	} {
		require.Error(t, sqlitex.Exec(conn, insert, nil, args...))
	}
}

func TestKeylineNodesConstraints(t *testing.T) {
	db := storage.MakeTestMemoryDB(t)
	conn, release, err := db.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()

	insert := dqb.Str("INSERT INTO keyline_nodes (name, blob_id, ts, blob_key) VALUES (?, ?, ?, ?)")

	require.NoError(t, sqlitex.Exec(conn, insert(), nil, "unknown-provenance", nil, nil, nil))
	require.NoError(t, sqlitex.Exec(conn, insert(), nil, "known-provenance", 1, 1, "opaque-blob"))
	for _, ts := range []int64{0, -1} {
		require.NoError(t, sqlitex.Exec(conn, insert(), nil, fmt.Sprintf("timestamp-%d", ts), 1, ts, "opaque-blob"))
	}

	for _, args := range [][]any{
		{nil, nil, nil, nil}, {"", nil, nil, nil}, {[]byte("name"), nil, nil, nil},
		{"unknown-provenance", 2, 1, "opaque-blob"}, {"known-provenance", nil, nil, nil},
		{"invalid", 0, 1, "opaque-blob"}, {"invalid", -1, 1, "opaque-blob"},
		{"invalid", 1.5, 1, "opaque-blob"}, {"invalid", "blob", 1, "opaque-blob"},
		{"invalid", 1, 1.5, "opaque-blob"}, {"invalid", 1, "timestamp", "opaque-blob"},
		{"invalid", 1, []byte("1"), "opaque-blob"},
		{"invalid", 1, 1, ""}, {"invalid", 1, 1, []byte("blob")},
	} {
		require.Error(t, sqlitex.Exec(conn, insert(), nil, args...), "node %v", args)
	}

	update := dqb.Str("UPDATE keyline_nodes SET blob_id = ?, ts = ?, blob_key = ? WHERE name = 'known-provenance'")
	for _, provenance := range [][]any{
		{1, nil, nil}, {nil, 1, nil}, {nil, nil, "opaque-blob"},
		{1, 1, nil}, {1, nil, "opaque-blob"}, {nil, 1, "opaque-blob"},
	} {
		args := append([]any{"incomplete-provenance"}, provenance...)
		err := sqlitex.Exec(conn, insert(), nil, args...)
		require.Equal(t, sqlite.SQLITE_CONSTRAINT_CHECK, sqlite.ErrCode(err), "insert provenance %v", provenance)
		err = sqlitex.Exec(conn, update(), nil, provenance...)
		require.Equal(t, sqlite.SQLITE_CONSTRAINT_CHECK, sqlite.ErrCode(err), "update provenance %v", provenance)
	}

	unknown, err := sqlitex.QueryOne[int](conn, dqb.Str("SELECT count(*) FROM keyline_nodes WHERE name = 'unknown-provenance' AND blob_id IS NULL AND ts IS NULL AND blob_key IS NULL AND typeof(id) = 'integer'")())
	require.NoError(t, err)
	require.Equal(t, 1, unknown)
	known, err := sqlitex.QueryOne[int](conn, dqb.Str("SELECT count(*) FROM keyline_nodes WHERE name = 'known-provenance' AND blob_id = 1 AND ts = 1 AND blob_key = 'opaque-blob'")())
	require.NoError(t, err)
	require.Equal(t, 1, known, "rejected updates must preserve the complete provenance")
}

func TestKeylineNodeReferences(t *testing.T) {
	for table, tc := range map[string]struct {
		insert string
		refs   int
	}{
		storage.T_KeylineDelegations: {"INSERT INTO keyline_delegations (id, issuer, audience, subject, power, blob_id) VALUES ('delegation', ?, ?, ?, 'a', 1)", 3},
		storage.T_KeylineRevocations: {"INSERT INTO keyline_revocations (id, issuer, target, blob_id) VALUES ('revocation', ?, 'missing-target', 1)", 1},
		storage.T_KeylineMembers:     {"INSERT INTO keyline_members (subject, member, power) VALUES (?, ?, 'a')", 2},
	} {
		t.Run(table, func(t *testing.T) {
			db := storage.MakeTestMemoryDB(t)
			conn, release, err := db.WriteConn(t.Context())
			require.NoError(t, err)
			defer release()

			require.NoError(t, sqlitex.Exec(conn, "INSERT INTO keyline_nodes (id, name) VALUES (1, 'one'), (2, 'two'), (3, 'three')", nil))
			args := make([]any, tc.refs)
			for i := range args {
				args[i] = i + 1
			}

			for i := range args {
				for _, invalid := range []any{nil, "uninterned", 999} {
					args[i] = invalid
					err := sqlitex.Exec(conn, tc.insert, nil, args...)
					require.Error(t, err, "reference %d: %v", i, invalid)

					if invalid == 999 {
						require.Equal(t, sqlite.SQLITE_CONSTRAINT_FOREIGNKEY, sqlite.ErrCode(err))
					}
				}

				args[i] = i + 1
			}

			// Referenced identities need no provenance, and a revocation may
			// target a record that has not arrived yet.
			require.NoError(t, sqlitex.Exec(conn, tc.insert, nil, args...))
			for _, id := range args {
				err := sqlitex.Exec(conn, "DELETE FROM keyline_nodes WHERE id = ?", nil, id)
				require.Equal(t, sqlite.SQLITE_CONSTRAINT_FOREIGNKEY, sqlite.ErrCode(err))
			}
		})
	}
}

func TestSchemaForeignKeyIndexes(t *testing.T) {
	// This test makes sure that all child foreign key columns are covered by at least one index.
	// Sometimes not having one could be justified, e.g. when the child table is very small, and not expensive to full scan,
	// but on the other hand, the overhead of having an index for these small tables would be even smaller. So it's probably
	// easier to just have a rule to make these columns always indexed.
	db := storage.MakeTestMemoryDB(t)

	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	introspectSchema(t, conn)
}

func TestAllTablesHaveSpecs(t *testing.T) {
	declared := make(map[string]struct{})
	db := storage.MakeTestMemoryDB(t)
	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	schema, err := sqlitegen.IntrospectSchema(conn)
	require.NoError(t, err)
	for _, column := range schema.Columns {
		declared[column.Table.String()] = struct{}{}
	}

	classified := make(map[string]struct{})
	for _, table := range storage.TableSpecs() {
		switch table.Kind {
		case storage.TableKindPermanent, storage.TableKindDerived, storage.TableKindIgnored:
		default:
			panic(fmt.Sprintf("table %q has unknown classification %d", table.Name, table.Kind))
		}
		if _, duplicate := classified[table.Name]; duplicate {
			panic(fmt.Sprintf("table %q is classified more than once", table.Name))
		}
		classified[table.Name] = struct{}{}
	}

	var missing, extra []string
	for table := range declared {
		if _, ok := classified[table]; !ok {
			missing = append(missing, table)
		}
	}
	for table := range classified {
		if _, ok := declared[table]; !ok {
			extra = append(extra, table)
		}
	}
	slices.Sort(missing)
	slices.Sort(extra)

	for _, table := range missing {
		t.Errorf("schema table %q is not classified; add it to storage.ReindexTables as permanent, derived, or ignored", table)
	}
	for _, table := range extra {
		t.Errorf("table classification %q does not match any schema table; remove it from storage.ReindexTables", table)
	}
}

func introspectSchema(t *testing.T, conn *sqlite.Conn) {
	// Iterate over all the tables in the schema.
	err := sqlitex.Exec(conn, "SELECT name FROM sqlite_master WHERE type = 'table';", func(stmt *sqlite.Stmt) error {
		tableName := stmt.ColumnText(0)

		// For each table iterate over all the foreign keys constraints defined.
		err := sqlitex.Exec(conn, fmt.Sprintf("PRAGMA foreign_key_list(%s);", tableName), func(foreignKeysStmt *sqlite.Stmt) error {
			from := foreignKeysStmt.ColumnText(3)

			// Across all the indexes defined on the table, check if the foreign key column is covered at least by one index.
			var found bool
			err := sqlitex.Exec(conn, fmt.Sprintf("PRAGMA index_list(%s);", tableName), func(indexesStmt *sqlite.Stmt) error {
				indexName := indexesStmt.ColumnText(1)

				// For compound indexes we only care about the first indexed column.
				err := sqlitex.Exec(conn, fmt.Sprintf("SELECT * FROM pragma_index_info('%s') WHERE seqno = 0;", indexName), func(indexColumnsStmt *sqlite.Stmt) error {
					columnName := indexColumnsStmt.ColumnText(2)
					if columnName == from {
						found = true
						return nil
					}
					return nil
				})
				if err != nil {
					return err
				}

				return nil
			})
			if err != nil {
				return err
			}

			if !found {
				t.Errorf("Table %q foreign key on column %q is not covered by any index", tableName, from)
			}
			return nil
		})
		if err != nil {
			return err
		}
		return nil
	})
	require.NoError(t, err)
}
