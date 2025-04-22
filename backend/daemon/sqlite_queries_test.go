package daemon

import (
	"seed/backend/storage"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDBQueries(t *testing.T) {
	// This test is here because this is the most top-level package which we know
	// imports all other packages that might have database queries. So all these
	// queries would have been registered with the global query store in the dqb package.
	// This test makes sure all queries are valid and use correct table and column names.
	t.Parallel()

	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, storage.InitSQLiteSchema(db))
	require.NoError(t, dqb.GlobalQueries.Test(db))
}

func TestFTS(t *testing.T) {
	t.Parallel()

	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()

	// Execute the CREATE VIRTUAL TABLE statement
	err = db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `CREATE VIRTUAL TABLE fts USING fts5(content, type, iri);`, nil)
	})
	require.NoError(t, err)

	// Execute the INSERT statement
	err = db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `INSERT INTO fts(content, type, iri) VALUES('My first comment', 'comment', 'hm://c/asdf');`, nil)
	})
	require.NoError(t, err)

	var content string
	var contentType string
	var contentIRI string
	err = db.WithSave(t.Context(), func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, `SELECT * FROM fts WHERE content MATCH 'First';`, func(stmt *sqlite.Stmt) error {
			content = stmt.ColumnText(0)
			contentType = stmt.ColumnText(1)
			contentIRI = stmt.ColumnText(2)
			return nil
		})
	})
	require.NoError(t, err)
	require.Equal(t, "My first comment", content)
	require.Equal(t, "comment", contentType)
	require.Equal(t, "hm://c/asdf", contentIRI)
}
