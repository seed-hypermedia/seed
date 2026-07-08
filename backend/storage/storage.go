// Package storage manages persistent storage of the Seed daemon.
package storage

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"seed/backend/core"
	"seed/backend/logging"
	"seed/backend/storage/vault"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/libp2p/go-libp2p/core/crypto"
	"go.uber.org/zap"
)

func init() {
	sqlite.SetLogger(logging.NewSlog("seed/sqlite", "warn"))
}

// Store is a storage directory on a filesystem.
type Store struct {
	path string
	log  *zap.Logger

	device *core.KeyPair

	db   *sqlitex.Pool
	ckpt *walCheckpointer
	kms  core.KeyStore
}

// Open initializes the storage directory.
// Device can be nil in which case a random new device key will be generated.
// Users are responsible for calling Close() to release the resources.
func Open(dataDir string, device crypto.PrivKey, kms core.KeyStore, logLevel string) (_ *Store, err error) {
	log := logging.New("seed/storage", logLevel)

	if !filepath.IsAbs(dataDir) {
		return nil, fmt.Errorf("must provide absolute repo path, got = %s", dataDir)
	}

	{
		dirs := [...]string{
			filepath.Join(dataDir, keysDir),
			filepath.Join(dataDir, dbDir),
		}
		for _, d := range dirs {
			if err := os.MkdirAll(d, 0700); err != nil {
				return nil, fmt.Errorf("failed to create dir %s: %w", d, err)
			}
		}
	}

	db, err := newSQLite(sqlitePath(dataDir))
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, db.Close())
		}
	}()

	// Drain any WAL left over from a previous run before we start serving. A
	// hard-killed daemon leaves its WAL un-truncated, and a large inherited WAL
	// makes every read slow (each read resolves pages through the WAL). Once the
	// app is up the constant readers stop the background PASSIVE checkpointer from
	// ever reclaiming it — PASSIVE only advances up to the oldest active reader —
	// so it stays huge and stalls indexing and serving. At startup there are no
	// readers yet, so a one-shot blocking TRUNCATE drains it cleanly: a brief boot
	// delay proportional to the inherited WAL, instead of a persistent live stall.
	var walBytesBefore int64
	if fi, statErr := os.Stat(sqlitePath(dataDir) + "-wal"); statErr == nil {
		walBytesBefore = fi.Size()
	}
	if err := db.ForWrite(func(conn *sqlite.Conn) error {
		// TRUNCATE reports the frame count *after* truncating (0), so we log the
		// pre-drain file size measured above instead.
		return sqlitex.ExecTransient(conn, "PRAGMA wal_checkpoint(TRUNCATE);", nil)
	}); err != nil {
		return nil, fmt.Errorf("failed to drain inherited WAL on startup: %w", err)
	}
	if walBytesBefore > 0 {
		log.Info("StartupWALDrained", zap.Int64("wal_bytes_before", walBytesBefore))
	}

	// Move WAL checkpointing off the single pool writer. PRAGMA
	// wal_autocheckpoint=0 stops the writer from stalling for seconds on inline
	// checkpoint fsyncs during bulk sync; the walCheckpointer flushes the WAL
	// from a dedicated connection instead. The two are a pair — see
	// walCheckpointer. Started here (before migration/reindex) so the heavy
	// first-run write path benefits too.
	if err := db.ForWrite(func(conn *sqlite.Conn) error {
		return sqlitex.ExecTransient(conn, "PRAGMA wal_autocheckpoint=0;", nil)
	}); err != nil {
		return nil, fmt.Errorf("failed to disable wal autocheckpoint: %w", err)
	}
	ckpt, err := newWALCheckpointer(sqlitePath(dataDir), defaultCheckpointInterval, log)
	if err != nil {
		return nil, fmt.Errorf("failed to start wal checkpointer: %w", err)
	}
	ckpt.start()
	defer func() {
		if err != nil {
			err = errors.Join(err, ckpt.Close())
		}
	}()

	ver, err := readVersionFile(dataDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read version file: %w", err)
	}

	if ver == "" {
		if device == nil {
			kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
			if err != nil {
				return nil, fmt.Errorf("failed to generate device key pair: %w", err)
			}

			device = kp.Libp2pKey()
		}

		if err := InitSQLiteSchema(db); err != nil {
			return nil, fmt.Errorf("failed to initialize SQLite database: %w", err)
		}

		if err := writeDeviceKeyFile(dataDir, device); err != nil {
			return nil, err
		}

		if err := writeVersionFile(dataDir, desiredVersion()); err != nil {
			return nil, fmt.Errorf("failed to write version file to init data directory: %w", err)
		}
	}

	kp, err := readDeviceKeyFile(dataDir)
	if err != nil {
		return nil, fmt.Errorf("failed to check device key from file: %w", err)
	}

	if device != nil {
		if !kp.Libp2pKey().Equals(device) {
			return nil, fmt.Errorf("provided device key (%s) doesn't match the stored one (%s)", device, kp.Libp2pKey())
		}
	}

	s := &Store{
		path:   dataDir,
		log:    log,
		kms:    kms,
		device: kp,
		db:     db,
		ckpt:   ckpt,
	}

	// TODO(hm24): This should probably be called from the outside somehow,
	// because we want to provide the feedback about the migration and reindexing
	// to the frontend that would call the Daemon API polling until everything is ready.
	if err := s.Migrate(); err != nil {
		return nil, err
	}

	return s, nil
}

// Close the storage.
func (s *Store) Close() error {
	var err error
	if s.ckpt != nil {
		// Stop the checkpointer (final WAL flush) before closing the pool.
		err = errors.Join(err, s.ckpt.Close())
	}
	return errors.Join(err, s.db.Close())
}

// DB returns the underlying database.
// Users must not close the database, because it's owned by the storage.
func (s *Store) DB() *sqlitex.Pool { return s.db }

// KeyStore returns the underlying key store.
func (s *Store) KeyStore() core.KeyStore { return s.kms }

// Vault returns the underlying vault by type-asserting the KeyStore implementation.
func (s *Store) Vault() (*vault.Vault, error) {
	v, ok := s.kms.(*vault.Vault)
	if !ok {
		return nil, fmt.Errorf("the underlying key store type %T is not a vault.Vault", s.kms)
	}

	return v, nil
}

// Migrate runs all migrations if needed.
// Must be called before using any other method of the storage.
func (s *Store) Migrate() error {
	ver, err := readVersionFile(s.path)
	if err != nil {
		return fmt.Errorf("failed to read version file: %w", err)
	}

	if ver == "" {
		panic("BUG: version file is empty when calling Migrate()")
	}

	if err := s.migrate(ver); err != nil {
		return fmt.Errorf("failed to migrate data directory: %w", err)
	}

	return nil
}

// Device returns the device key pair.
func (s *Store) Device() *core.KeyPair {
	return s.device
}

func newSQLite(path string) (*sqlitex.Pool, error) {
	// Pool size gates how many concurrent SQLite operations can be in flight.
	// Bitswap's GetSize, per-peer connect lookups, peer-exchange, and domain
	// tracking all pull connections from this pool; when the pool is exhausted,
	// writers queue, then collide on BEGIN IMMEDIATE once they get a conn.
	// Grew from NumCPU/2-with-floor-8 to NumCPU-with-floor-12 to keep readers
	// from starving writers under p2p sync load. Higher floor trades a bit of
	// resident memory per conn for much less SQLITE_BUSY under normal traffic.
	poolSize := max(runtime.NumCPU(), 12)

	// The database is owned by the store, and is closed when the store is closed.
	db, err := OpenSQLite(path, 0, poolSize)
	if err != nil {
		return nil, err
	}

	return db, nil
}

func sqlitePath(baseDir string) string {
	return filepath.Join(baseDir, dbDir, "db.sqlite")
}
