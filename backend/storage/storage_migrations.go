package storage

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"seed/backend/core"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/libp2p/go-libp2p/core/crypto"

	"golang.org/x/exp/slices"
)

/*
Current data dir layout:

<data-dir>/
├─ db/
│  ├─ db.sqlite
├─ keys/
│  ├─ libp2p_id_ed25519
├─ seed-daemon.conf
├─ VERSION

When making changes to database schema or directory layout,
make sure to update the initialization code which creates everything from scratch,
and add the necessary migrations to drive the current state of the directory to the new desired state.
*/

// migration specifies the version of the desired state of the directory,
// and provides a run function to drive the directory to that state from the previous version.
// The Run function should be as idempotent as possible to avoid issues with partially applied migrations.
// The DB connection inside the Run function is already wrapped into an immediate write transaction.
type migration struct {
	Version string
	Run     func(*Store, *sqlite.Conn) error
}

// In order for a migration to actually run, it has to have a version higher than the version of the data directory.
// Care has to be taken when migrations are being added in main, and feature branches in parallel.
// Specifically, don't run code with migrations in feature branches on top of your production database!
//
// It's important to backup your data directory when trying out the code from a feature branch that has a migration.
// Otherwise when you switch back to the main branch the program will complain about an unknown version of the data directory.
//
// Migrations should be idempotant as much as we can make them, to prevent issues with partially applied migrations.
//
// The list of migration is in descending order, because it's easier to add them to the top than having to scroll to the bottom all the time.
//
// To add a new migration, follow the pattern of the existing ones, and choose the current date accordingly as a version.
// If multiple migrations need to be made in the same day, the incrementing suffix can be used.
//
// In case of even the most minor doubts, consult with the team before adding a new migration, and submit the code to review if needed.
var migrations = []migration{

	{Version: "2025-07-25.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			ALTER TABLE fts_index
			ADD COLUMN ts INTEGER;
			`)); err != nil {
			return err
		}
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			ALTER TABLE fts_index
			ADD COLUMN genesis_blob INTEGER;
			`)); err != nil {
			return err
		}
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			CREATE INDEX fts_index_by_ts ON fts_index (ts);
			`)); err != nil {
			return err
		}
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			CREATE INDEX fts_index_by_genesis_blob ON fts_index (genesis_blob);
			`)); err != nil {
			return err
		}
		// Reindexing to fix comment causality issues again.
		return scheduleReindex(conn)
	}},
	{Version: "2025-07-22.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Reindexing to fix comment causality issues again.
		return scheduleReindex(conn)
	}},
	{Version: "2025-07-15.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			DROP TABLE IF EXISTS fts;

			CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
				raw_content,
				type UNINDEXED,
				blob_id UNINDEXED,
				block_id UNINDEXED,
				version UNINDEXED
			);

			DROP TABLE IF EXISTS fts_index;

			CREATE TABLE IF NOT EXISTS fts_index (
				rowid INTEGER PRIMARY KEY,
				blob_id INTEGER NOT NULL,
				version TEXT NOT NULL,
				block_id TEXT NOT NULL,
				type TEXT NOT NULL
			) WITHOUT ROWID;
			CREATE INDEX fts_index_by_blob ON fts_index (blob_id);
			CREATE INDEX fts_index_by_version ON fts_index (version);
			CREATE INDEX fts_index_by_block ON fts_index (block_id);
			CREATE INDEX fts_index_by_type ON fts_index (type);
		`)); err != nil {
			return err
		}

		return scheduleReindex(conn)
	}},
	{Version: "2025-07-09.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Reindexing to fix comment causality issues again.
		return scheduleReindex(conn)
	}},
	{Version: "2025-07-03.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Add blob type to the index.
		return sqlitex.ExecScript(conn, sqlfmt(`
			DROP INDEX IF EXISTS structural_blobs_by_resource;
			CREATE INDEX IF NOT EXISTS structural_blobs_by_resource ON structural_blobs (resource, type);
		`))
	}},
	{Version: "2025-06-30.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Reindexing to fix comment causality issues.
		return scheduleReindex(conn)
	}},
	{Version: "2025-06-20.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			CREATE INDEX structural_blobs_by_tsid ON structural_blobs (extra_attrs->>'tsid') WHERE extra_attrs->>'tsid' IS NOT NULL;
		`)); err != nil {
			return err
		}

		return scheduleReindex(conn)
	}},
	{Version: "2025-06-19.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Reindexing to add Profiles to search.
		return scheduleReindex(conn)
	}},
	{Version: "2025-06-12.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Reindexing to add IDs for comments.
		return scheduleReindex(conn)
	}},
	{Version: "2025-06-09.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Reindexing to get the home document titles in search.
		return scheduleReindex(conn)
	}},
	{Version: "2025-06-02.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Reindexing to add IDs for contacts.
		return scheduleReindex(conn)
	}},
	{Version: "2025-05-25.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			CREATE INDEX contacts_by_subject ON structural_blobs (extra_attrs->>'subject', ts, author) WHERE type = 'Contact';
			CREATE INDEX structural_blobs_by_type ON structural_blobs (type, ts, resource, author);
		`)); err != nil {
			return err
		}
		return nil
	}},
	{Version: "2025-05-22.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		// Reindexing to support having profiles without home documents.
		return scheduleReindex(conn)
	}},
	{Version: "2025-04-28.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			DROP TABLE IF EXISTS fts5;
		`)); err != nil {
			return err
		}
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
				raw_content,
				type,
				blob_id,
				block_id,
				version
			);
		`)); err != nil {
			return err
		}
		return scheduleReindex(conn)
	}},
	{Version: "2025-04-14.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		return sqlitex.ExecScript(conn, sqlfmt(`
			CREATE INDEX profiles_by_alias ON structural_blobs (extra_attrs->>'alias', author) WHERE type = 'Profile' AND extra_attrs->>'alias' IS NOT NULL;
		`))
	}},
	{Version: "2025-03-27.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			CREATE INDEX capabilities_by_delegate ON structural_blobs (extra_attrs->>'del', resource, author) WHERE type = 'Capability';
		`)); err != nil {
			return err
		}

		return scheduleReindex(conn)
	}},
	{Version: "2025-02-06.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		return sqlitex.ExecScript(conn, sqlfmt(`
			DROP VIEW IF EXISTS meta_view;
		`))
	}},
	{Version: "2025-02-02.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := scheduleReindex(conn); err != nil {
			return err
		}

		return sqlitex.ExecScript(conn, sqlfmt(`
			CREATE TABLE IF NOT EXISTS stashed_blobs (
			    id INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE NOT NULL,
			    reason TEXT NOT NULL,
			    extra_attrs JSON NOT NULL,
				PRIMARY KEY (id, reason, extra_attrs)
			) WITHOUT ROWID;
		`))
	}},
	{Version: "2025-01-16.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		return scheduleReindex(conn)
	}},
	{Version: "2025-01-09.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		return sqlitex.ExecScript(conn, sqlfmt(`
			CREATE TABLE unread_resources (
			    iri TEXT PRIMARY KEY NOT NULL
			) WITHOUT ROWID;
		`))
	}},
	{Version: "2025-01-01.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		return scheduleReindex(conn)
	}},
	{Version: "2024-12-16.02", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := sqlitex.ExecScript(conn, sqlfmt(`
			CREATE TABLE spaces (
				id TEXT PRIMARY KEY CHECK (id != ''),
				last_comment INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE,
				last_comment_time INTEGER NOT NULL DEFAULT (0),
				comment_count INTEGER NOT NULL DEFAULT (0),
				last_change_time INTEGER NOT NULL DEFAULT (0)
			) WITHOUT ROWID;

			CREATE INDEX spaces_by_last_comment ON spaces (last_comment) WHERE last_comment IS NOT NULL;

			CREATE TABLE document_generations (
				resource INTEGER REFERENCES resources (id) ON UPDATE CASCADE ON DELETE CASCADE NOT NULL,
				generation INTEGER NOT NULL,
				genesis TEXT NOT NULL,
				heads JSON NOT NULL DEFAULT ('[]'),
				change_count INTEGER NOT NULL DEFAULT (0),
				genesis_change_time INTEGER NOT NULL,
				last_change_time INTEGER NOT NULL DEFAULT (0),
				last_tombstone_ref_time INTEGER NOT NULL DEFAULT (0),
				last_alive_ref_time INTEGER NOT NULL DEFAULT (0),
				is_deleted GENERATED ALWAYS AS (last_tombstone_ref_time > last_alive_ref_time) VIRTUAL,
				last_comment INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE,
			    last_comment_time INTEGER NOT NULL DEFAULT (0),
				last_activity_time GENERATED ALWAYS AS (MAX(last_comment_time, last_alive_ref_time)) VIRTUAL,
			    comment_count INTEGER NOT NULL DEFAULT (0),
				authors JSON NOT NULL DEFAULT ('[]'),
				metadata JSON NOT NULL DEFAULT ('{}'),
				changes BLOB,
				PRIMARY KEY (resource, generation, genesis)
			) WITHOUT ROWID;

			CREATE INDEX document_generations_by_last_comment ON document_generations (last_comment) WHERE last_comment IS NOT NULL;
		`)); err != nil {
			return err
		}

		return scheduleReindex(conn)
	}},
	{Version: "2024-11-27.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		return sqlitex.ExecScript(conn, sqlfmt(`DELETE FROM wallets`)) // User will have to recreate the wallet
	}},
	{Version: "2024-11-11.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		if err := sqlitex.ExecScript(conn, "DROP TABLE IF EXISTS deleted_resources;"); err != nil {
			return err
		}

		return scheduleReindex(conn)
	}},
	{Version: "2024-11-01.01", Run: func(_ *Store, conn *sqlite.Conn) error {
		return sqlitex.ExecScript(conn, sqlfmt(`
			DROP TABLE IF EXISTS wallets;
			CREATE TABLE wallets (
				id TEXT PRIMARY KEY,
				account INTEGER REFERENCES public_keys (id) ON DELETE CASCADE NOT NULL,
				type TEXT CHECK( type IN ('lnd','lndhub.go','lndhub') ) NOT NULL DEFAULT 'lndhub.go',
				address TEXT NOT NULL,
				login BLOB NOT NULL,
				password BLOB NOT NULL,
				token BLOB,
				name TEXT NOT NULL
			);
			CREATE INDEX wallets_by_account ON wallets (account);
			DELETE FROM kv WHERE key = 'default_wallet';
			DELETE FROM kv WHERE key = 'lndhub_login_signature';
		`))
	}},
	// New beginning.
	{Version: "2024-10-19.01", Run: func(_ *Store, _ *sqlite.Conn) error {
		return nil
	}},
}

func init() {
	// Reversing the migrations because all the code depends on them being in ascending order (newest in the end),
	// but for humans it's easier to write them the other way around, to prevent having to scroll the list to the bottom when it grows.
	slices.Reverse(migrations)
}

func scheduleReindex(conn *sqlite.Conn) error {
	return SetKV(context.Background(), conn, "last_reindex_time", "", true)
}

func desiredVersion() string {
	ver := migrations[len(migrations)-1].Version
	if ver == "" {
		panic("BUG: couldn't find the desired storage schema version")
	}

	return ver
}

const (
	keysDir = "keys"
	dbDir   = "db"

	devicePrivateKeyPath = keysDir + "/libp2p_id_ed25519"

	versionFilename = "VERSION"
)

func (s *Store) migrate(currentVersion string) error {
	desiredVersion := migrations[len(migrations)-1].Version
	if currentVersion > desiredVersion {
		return fmt.Errorf("OLD VERSION: you are running an old version of Seed: your data dir version is %q and it can't be downgraded to %q", currentVersion, desiredVersion)
	}

	// Running migrations if necessary.
	{
		idx, ok := slices.BinarySearchFunc(migrations, currentVersion, func(m migration, target string) int {
			if m.Version == target {
				return 0
			}

			if m.Version < target {
				return -1
			}

			return +1
		})
		if !ok {
			return fmt.Errorf("BREAKING CHANGE: this version of Seed is incompatible with your existing data: remove your data directory located in %q", s.path)
		}

		pending := migrations[idx+1:]

		conn, release, err := s.db.Conn(context.Background())
		if err != nil {
			return err
		}
		defer release()

		if len(pending) > 0 {
			// There's no easy way to lock the entire database for a long time to prevent other connections to access it.
			// PRAGMA locking_mode = EXCLUSIVE doesn't seem to work as expected, or at least it doesn't fit this use case.
			// We attempt to work around this by starting an immediate transaction for the entire migration process.
			// We use savepoints for each migration, but we still may hit some limitations if transaction gets too big.
			// Hopefully this will never happen in practice.
			if err := sqlitex.ExecTransient(conn, "BEGIN IMMEDIATE;", nil); err != nil {
				return err
			}

			for _, mig := range pending {
				// In case of a problem like a power outage, we could end up with an applied migration,
				// but without the version file being written, in which case things will be bad.
				// To reduce this risk to some extent, we write the version file after each migration.
				// We should also make migrations idempotent as much as we can.
				//
				// TODO(burdiyan): maybe move the version information into the database so everything could be done atomically,
				// or implement some sort of recovery mechanism for these situations.

				save := sqlitex.Save(conn)
				if err := mig.Run(s, conn); err != nil {
					return err
				}
				save(&err)
				if err != nil {
					return err
				}

				if err := writeVersionFile(s.path, mig.Version); err != nil {
					return fmt.Errorf("failed to write version file: %w", err)
				}
			}

			// We need to unlock the database so it be used after we've done the migration.
			if err := sqlitex.ExecTransient(conn, "COMMIT;", nil); err != nil {
				return err
			}
		}
	}

	// Preparing the device key.
	{
		kp, err := readDeviceKeyFile(s.path)
		if err != nil {
			return fmt.Errorf("failed to load device key from file: %w", err)
		}

		if s.device.Libp2pKey() != nil {
			if !s.device.Libp2pKey().Equals(kp.Libp2pKey()) {
				return fmt.Errorf("device key loaded from file (%s) doesn't match the desired key (%s)", kp.PeerID(), s.device.PeerID())
			}
		} else {
			s.device = kp
		}
	}

	return nil
}

func readVersionFile(dir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(dir, versionFilename))
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}

	return string(data), err
}

func writeVersionFile(dir, version string) error {
	return os.WriteFile(filepath.Join(dir, versionFilename), []byte(version), 0600)
}

func writeDeviceKeyFile(dir string, pk crypto.PrivKey) error {
	data, err := crypto.MarshalPrivateKey(pk)
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(dir, devicePrivateKeyPath), data, 0600)
}

func readDeviceKeyFile(dir string) (kp *core.KeyPair, err error) {
	data, err := os.ReadFile(filepath.Join(dir, devicePrivateKeyPath))
	if err != nil {
		return kp, fmt.Errorf("failed to read the file: %w", err)
	}

	pk, err := crypto.UnmarshalPrivateKey(data)
	if err != nil {
		return kp, fmt.Errorf("failed to unmarshal private key for device: %w", err)
	}

	return core.KeyPairFromLibp2p(pk)
}
