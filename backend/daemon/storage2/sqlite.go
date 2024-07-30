package storage

import (
	"context"
	"crypto/rand"
	"math"
	"math/big"
	"path/filepath"
	"seed/backend/daemon/storage/dbext"
	"seed/backend/testutil"
	"testing"
	"time"

	"crawshaw.io/sqlite"
	"crawshaw.io/sqlite/sqlitex"
	"github.com/stretchr/testify/require"
)

import "C"

// OpenSQLite opens a connection pool for SQLite, enabling some needed functionality for our schema
// like foreign keys.
func OpenSQLite(uri string, flags sqlite.OpenFlags, poolSize int) (*sqlitex.Pool, error) {
	return openSQLite(uri, flags, poolSize,
		"PRAGMA foreign_keys = ON;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA journal_mode = WAL;",
		// "PRAGMA cache_size = -20000;",
		"PRAGMA temp_store = MEMORY;",
	)
}

func openSQLite(uri string, flags sqlite.OpenFlags, poolSize int, prelude ...string) (*sqlitex.Pool, error) {
	if err := dbext.LoadExtensions(); err != nil {
		return nil, err
	}

	pool, err := sqlitex.Open(uri, flags, poolSize)
	if err != nil {
		return nil, err
	}

	if err := pool.ForEach(func(conn *sqlite.Conn) error {
		for _, stmt := range prelude {
			if err := sqlitex.ExecTransient(conn, stmt, nil); err != nil {
				return err
			}
		}

		conn.SetBusyTimeout(time.Minute * 3)

		return nil
	}); err != nil {
		return nil, err
	}

	return pool, nil
}

func initSQLite(conn *sqlite.Conn) error {
	return sqlitex.WithTx(conn, func() error {
		return sqlitex.ExecScript(conn, schema)
	})
}

// InitSQLiteSchema initializes the database with the corresponding schema.
func InitSQLiteSchema[T *sqlite.Conn | *sqlitex.Pool](db T) error {
	var conn *sqlite.Conn
	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *sqlitex.Pool:
		c, release, err := v.Conn(context.Background())
		if err != nil {
			return err
		}
		defer release()
		conn = c
	}

	return initSQLite(conn)
}

// MakeTestDB is a test helper to use our database schema in tests.
func MakeTestDB(t testing.TB) *sqlitex.Pool {
	t.Helper()

	path := testutil.MakeRepoPath(t)

	pool, err := newSQLite(filepath.Join(path, "db.sqlite"))
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, pool.Close())
	})
	require.NoError(t, InitSQLiteSchema(pool))
	return pool
}

// MakeTestMemoryDB is the same as MakeTestDB but using an in-memory database.
func MakeTestMemoryDB(t testing.TB) *sqlitex.Pool {
	t.Helper()

	ri, err := rand.Int(rand.Reader, big.NewInt(math.MaxInt64))
	if err != nil {
		panic(err)
	}

	db, err := newSQLite("file:seed-testing-" + ri.String() + "?mode=memory&cache=shared")
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	require.NoError(t, InitSQLiteSchema(db))
	return db
}

// SetKV sets a key-value pair in the database.
func SetKV[T *sqlite.Conn | *sqlitex.Pool](ctx context.Context, db T, key, value string, replace bool) error {
	var conn *sqlite.Conn
	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *sqlitex.Pool:
		c, release, err := v.Conn(ctx)
		if err != nil {
			return err
		}
		defer release()
		conn = c
	}

	if replace {
		return sqlitex.Exec(conn, "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?);", nil, key, value)
	}

	return sqlitex.Exec(conn, "INSERT INTO kv (key, value) VALUES (?, ?);", nil, key, value)
}

// GetKV gets a key-value pair from the database.
func GetKV[T *sqlite.Conn | *sqlitex.Pool](ctx context.Context, db T, key string) (string, error) {
	var conn *sqlite.Conn
	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *sqlitex.Pool:
		c, release, err := v.Conn(ctx)
		if err != nil {
			return "", err
		}
		defer release()
		conn = c
	}

	var value string
	err := sqlitex.Exec(conn, "SELECT value FROM kv WHERE key = ?;", func(stmt *sqlite.Stmt) error {
		value = stmt.ColumnText(0)
		return nil
	}, key)
	if err != nil {
		return "", err
	}

	return value, nil
}
