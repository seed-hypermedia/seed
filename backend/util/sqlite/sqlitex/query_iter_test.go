package sqlitex

import (
	"seed/backend/util/sqlite"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestQuery(t *testing.T) {
	conn, err := sqlite.OpenConn("file::memory:", 0)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	require.NoError(t, ExecTransient(conn, "CREATE TABLE my_table (a TEXT PRIMARY KEY, b INTEGER);", nil))

	want := []string{"my_table", "sqlite_autoindex_my_table_1"}
	var got []string

	rows, errs := Query(conn, "SELECT name FROM sqlite_master")
	for stmt := range rows {
		got = append(got, stmt.ColumnText(0))
	}
	require.NoError(t, errs.Check())

	require.Equal(t, want, got)
}
