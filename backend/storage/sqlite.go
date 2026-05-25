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
// wal_checkpoint(PASSIVE). Tightened from 5s to 2s after live diagnosis on
// /debug/sqlite showed individual ticks taking 0.5-1.6s on a slow disk
// (the per-fsync latency is the floor, not per-frame work). A 2s cadence
// keeps the WAL small enough that any single tick touches few frames,
// reduces the worst-case window of slow-COMMIT exposure via kernel
// writeback, and reduces the briefly-held writer-mutex contention that
// PRAGMA wal_checkpoint(PASSIVE) takes during its WAL-header update.
// Tradeoff: more goroutine wakeups. Negligible at this cadence (~30/min).
const walCheckpointInterval = 2 * time.Second

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
// Also spawns a background PRAGMA wal_checkpoint(PASSIVE) goroutine on a
// DEDICATED *sqlite.Conn (not borrowed from the pool). The dedicated
// conn means a slow checkpoint tick (disk fsync stalls can push
// wal_checkpoint to >1 s even for tiny WALs) does NOT shrink the
// foreground pool by 1 for the duration. The goroutine self-exits when
// pool.Closed() fires; a small reaper goroutine then closes the
// dedicated conn so resources are released cleanly.
func OpenSQLite(uri string, flags sqlite.OpenFlags, poolSize int) (*sqlitex.Pool, error) {
	prelude := []string{
		"PRAGMA foreign_keys = ON;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA journal_mode = WAL;",
		"PRAGMA cache_size = -262144;",
		"PRAGMA temp_store = MEMORY;",
		// Push the foreground auto-checkpoint threshold well above what the
		// background goroutine should ever let the WAL reach. See doc comment
		// on walAutoCheckpointPages.
		fmt.Sprintf("PRAGMA wal_autocheckpoint = %d;", walAutoCheckpointPages),
	}
	pool, err := openSQLite(uri, flags, poolSize, prelude...)
	if err != nil {
		return nil, err
	}

	// Open the dedicated checkpoint conn with the same URI/flags as the
	// pool, apply the same prelude so its view of foreign_keys / journal
	// mode / etc. is consistent.
	ckptConn, err := sqlite.OpenConn(uri, flags)
	if err != nil {
		_ = pool.Close()
		return nil, fmt.Errorf("open dedicated WAL-checkpoint conn: %w", err)
	}
	for _, stmt := range prelude {
		if err := sqlitex.ExecTransient(ckptConn, stmt, nil); err != nil {
			_ = ckptConn.Close()
			_ = pool.Close()
			return nil, fmt.Errorf("apply prelude to dedicated WAL-checkpoint conn: %w", err)
		}
	}

	stop := sqlitex.StartWALCheckpointer(pool, ckptConn, walCheckpointInterval, zapLogger{
		log: logging.New("seed/sqlite/wal", "info"),
	})
	// Reaper: on pool.Close, stop the checkpointer goroutine, then close
	// the dedicated conn. Order matters — closing the conn while the
	// goroutine is still running its tick would race PRAGMA execution.
	go func() {
		<-pool.Closed()
		stop()
		_ = ckptConn.Close()
	}()
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
