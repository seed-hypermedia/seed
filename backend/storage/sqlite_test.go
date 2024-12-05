package storage

import (
	"os"
	"seed/backend/util/sqlitedbg"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSQLite(t *testing.T) {
	pool, err := OpenSQLite("file::memory:?mode=memory&cache=shared", 0, 1)
	require.NoError(t, err)

	defer pool.Close()

	sqlitedbg.ExecPool(pool, os.Stdout, "select sha1('hello')")
	sqlitedbg.ExecPool(pool, os.Stdout, "select mycount() from (values (1), (2));")
	sqlitedbg.ExecPool(pool, os.Stdout, "select * FROM carray(rb_array(rb_create(1,2,3,4,5,6,1000,130,145,5000)), 10)")
}
