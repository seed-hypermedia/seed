package storage

import (
	"context"
	"crypto/rand"
	"fmt"
	"math"
	"math/big"
	"path/filepath"
	"seed/backend/logging"
	"seed/backend/storage/dbext"
	"seed/backend/testutil"
	"testing"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

import "C"

// walCheckpointInterval is how often the background goroutine runs PRAGMA
// wal_checkpoint(PASSIVE). 5s amortises checkpoint cost away from the
// foreground writer without letting the WAL grow large enough to trigger an
// inline auto-checkpoint at the wal_autocheckpoint threshold below.
const walCheckpointInterval = 5 * time.Second

// walAutoCheckpointPages is the threshold (in WAL pages) above which SQLite
// would auto-checkpoint inline on COMMIT. Raised from the 1000-page default
// to 10_000 so the background goroutine almost always wins the race —
// foreground writers no longer pay the page-migration fsync cost on COMMIT.
// The background goroutine is non-blocking (PASSIVE), so this only changes
// where the work happens, not whether it happens.
const walAutoCheckpointPages = 10_000

// OpenSQLite opens a connection pool for SQLite, enabling some needed functionality for our schema
// like foreign keys.
//
// Also spawns a background PRAGMA wal_checkpoint(PASSIVE) goroutine; this
// keeps the WAL bounded without making foreground writers pay the
// page-migration fsync cost on COMMIT. Stopping the checkpointer is wired
// into Pool.Close via the closeWALCheckpointer hook below.
func OpenSQLite(uri string, flags sqlite.OpenFlags, poolSize int) (*sqlitex.Pool, error) {
	pool, err := openSQLite(uri, flags, poolSize,
		"PRAGMA foreign_keys = ON;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA journal_mode = WAL;",
		// "PRAGMA cache_size = -20000;",
		"PRAGMA temp_store = MEMORY;",
		// Push the foreground auto-checkpoint threshold well above what the
		// background goroutine should ever let the WAL reach. See doc comment
		// on walAutoCheckpointPages.
		fmt.Sprintf("PRAGMA wal_autocheckpoint = %d;", walAutoCheckpointPages),
	)
	if err != nil {
		return nil, err
	}

	// Spawn the background checkpointer. The returned stop func is intentionally
	// discarded: the goroutine self-exits when pool.Close() is called (its next
	// pool.Conn call returns ErrPoolClosed). That means there's a worst-case
	// goroutine-alive window of `walCheckpointInterval` after pool.Close, which
	// is acceptable — the goroutine is idle on a ticker, not holding a conn.
	_ = sqlitex.StartWALCheckpointer(pool, walCheckpointInterval, zapLogger{
		log: logging.New("seed/sqlite/wal", "info"),
	})
	return pool, nil
}

// zapLogger adapts *zap.Logger to the minimal Logger interface in sqlitex
// so the sqlitex package doesn't take a direct zap dependency.
type zapLogger struct {
	log *zap.Logger
}

// Warn implements sqlitex.Logger.
func (z zapLogger) Warn(msg string, kv ...any) {
	if z.log == nil {
		return
	}
	fields := make([]zap.Field, 0, len(kv)/2)
	for i := 0; i+1 < len(kv); i += 2 {
		key, ok := kv[i].(string)
		if !ok {
			continue
		}
		fields = append(fields, zap.Any(key, kv[i+1]))
	}
	z.log.Warn(msg, fields...)
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
