package sqlitex_test

import (
	"context"
	"testing"
	"time"

	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

func TestInterruptWithSave(t *testing.T) {
	dbpool := newMemPool(t)
	defer func() {
		if err := dbpool.Close(); err != nil {
			t.Error(err)
		}
	}()
	var iterations = int64(500_000)

	ctx, cancel := context.WithCancel(t.Context())
	var err error
	go func() {
		err = dbpool.WithSave(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, sleepQuery(), func(stmt *sqlite.Stmt) error {
				return nil
			}, iterations)
		})
	}()
	time.Sleep(100 * time.Millisecond)
	cancel()
	time.Sleep(100 * time.Millisecond)
	require.Error(t, err, "expected an error from WithSave, but not a panic")
}

var sleepQuery = dqb.Str(`
with recursive
  spin(i) as (
    select 0
    union all
    select i + 1 from spin where i < :iterations
  )
select i from spin;
`)
