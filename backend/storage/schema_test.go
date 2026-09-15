package storage_test

import (
	"fmt"
	"slices"
	"testing"

	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/sqlitegen"

	"github.com/stretchr/testify/require"
)

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
