package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"seed/backend/config"
	"seed/backend/core/coretest"
	"seed/backend/core/keystore"
	"seed/backend/keyline/keylinesqlite"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/sqlitegen"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const snapshotDataDir = "./testdata/seed-test-db-snapshot"

func TestMigrationsOnInitialSnapshot(t *testing.T) {
	// This test takes our initial database snapshot stored in ./testdata
	// and runs the migrations on it, to see if the migrated database
	// would look the same as the newly created one.
	//
	// When we make a breaking database change we want to regenerate the golden snapshot,
	// which can be done by running the TestMigrations_GenerateGoldenSnapshot test manually from the IDE,
	// or from the command line with:
	//
	// ```
	// go test ./backend/storage -run TestMigrations_GenerateGoldenSnapshot
	// ```
	runMigrationsTest(t)
}

func generateGoldenSnapshot() {
	alice := coretest.NewTester("alice")

	cfg := config.Default()
	cfg.P2P.NoRelay = true
	cfg.P2P.BootstrapPeers = nil
	cfg.Base.DataDir = filepath.Join(must.Do2(os.Getwd()), snapshotDataDir)

	if err := os.RemoveAll(cfg.Base.DataDir); err != nil {
		panic(err)
	}

	if err := os.MkdirAll(cfg.Base.DataDir, 0750); err != nil {
		panic(err)
	}

	dir, err := Open(cfg.Base.DataDir, alice.Device.Libp2pKey(), keystore.NewMemory(), cfg.LogLevel)
	if err != nil {
		panic(err)
	}
	defer dir.Close()

	fmt.Println("Database has been saved in:", cfg.Base.DataDir)
	if errors.Is(err, context.Canceled) {
		panic(fmt.Errorf("error unexpected: %w", err))
	}
}

func runMigrationsTest(t *testing.T) {
	migrateDir := t.TempDir()
	err := copyDir(snapshotDataDir, migrateDir)
	require.NoError(t, err)

	alice := coretest.NewTester("alice")

	migratedStore, err := Open(migrateDir, alice.Device.Libp2pKey(), keystore.NewMemory(), "debug")
	require.NoError(t, err)
	require.NoError(t, migratedStore.Migrate())
	defer migratedStore.Close()

	freshStore, err := Open(t.TempDir(), alice.Device.Libp2pKey(), keystore.NewMemory(), "debug")
	require.NoError(t, err)
	require.NoError(t, freshStore.Migrate())
	defer freshStore.Close()

	migratedDB, freshDB := migratedStore.db, freshStore.db

	migratedSchema, err := sqlitegen.IntrospectSchema(migratedDB)
	require.NoError(t, err)

	freshSchema, err := sqlitegen.IntrospectSchema(freshDB)
	require.NoError(t, err)

	require.Equal(t, migratedSchema, freshSchema)

	migratedRawSchema := getRawSQLSchema(t, migratedDB)
	freshRawSchema := getRawSQLSchema(t, freshDB)

	migratedTables := slices.Collect(maps.Keys(migratedRawSchema))
	slices.Sort(migratedTables)

	freshTables := slices.Collect(maps.Keys(freshRawSchema))
	slices.Sort(freshTables)

	require.Equal(t, freshTables, migratedTables, "migrated table names don't match fresh ones")

	for _, table := range freshTables {
		checkSQLEqual(t, freshRawSchema[table], migratedRawSchema[table])

		if strings.HasPrefix(table, "keyline_") {
			require.Equal(t, freshRawSchema[table], migratedRawSchema[table], "Keyline requires exact DDL compatibility")
		}
	}

	for _, db := range []*sqlitex.Pool{freshDB, migratedDB} {
		require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
			require.NoError(t, keylinesqlite.Init(t.Context(), conn))
			return nil
		}))
	}

	// We want to check that the version file matches the version of the last migration.
	require.Equal(t, migrations[len(migrations)-1].Version, must.Do2(readVersionFile(migratedStore.path)))
	require.Equal(t, migrations[len(migrations)-1].Version, must.Do2(readVersionFile(freshStore.path)))
}

func getRawSQLSchema(t *testing.T, db *sqlitex.Pool) map[string]string {
	out := make(map[string]string) // table to sql.
	conn, release, err := db.ReadConn(context.Background())
	require.NoError(t, err)
	defer release()

	rows, discard, check := sqlitex.Query(conn, "select name, sql from sqlite_schema order by name").All()
	defer func() {
		var err error
		discard(&err)
		require.NoError(t, err)
	}()
	for r := range rows {
		out[r.ColumnText(0)] = r.ColumnText(1)
	}
	require.NoError(t, check())

	return out
}

var re = regexp.MustCompile(`\s+`)

func checkSQLEqual(t *testing.T, want, got string) {
	t.Helper()
	want = re.ReplaceAllString(want, "")
	got = re.ReplaceAllString(got, "")
	require.Equal(t, want, got)
}

func TestKeylineMigrationDoesNotScheduleReindex(t *testing.T) {
	db := MakeTestMemoryDB(t)
	idx := slices.IndexFunc(migrations, func(m migration) bool {
		return m.Version == "2026-11-03.104504"
	})
	require.NotEqual(t, -1, idx, "Keyline migration must exist")

	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		// Reproduce the preceding schema with validated blobs, completed search
		// work, and both materialized and unmaterialized reconciliation scopes.
		require.NoError(t, sqlitex.ExecScript(conn, `
			DROP TABLE keyline_members;
			DROP TABLE keyline_delegations;
			DROP TABLE keyline_revocations;
			DROP TABLE keyline_nodes;
			INSERT INTO kv (key, value) VALUES
				('last_reindex_time', 'already-indexed'),
				('keyline_projection_version', 'old-projection'),
				('unrelated', 'preserved');
			INSERT INTO blobs (id, multihash, codec, size, data) VALUES (1, X'0102', 113, 4, X'DEADBEEF');
			INSERT INTO resources (id, iri) VALUES (1, 'hm://subject');
			INSERT INTO structural_blobs (id, type, resource) VALUES (1, 'Capability', 1);
			INSERT INTO fts (rowid, raw_content) VALUES (1, 'preserved content');
			INSERT INTO embeddings (rowid, multilingual_minilm_l12_v2, fts_id) VALUES (1, vec_int8(zeroblob(384)), 1);
			INSERT INTO embeddings_index (fts_id) VALUES (1);
			INSERT INTO rbsr_scope (id, iri, kind, materialized, last_access) VALUES
				(1, 'hm://subject', 0, 1, 123),
				(2, 'hm://subject', 1, 0, 456);
			INSERT INTO rbsr_item (scope, blob) VALUES (1, 1);
		`))
		return nil
	}))

	for range 2 {
		require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
			return migrations[idx].Run(nil, conn)
		}))
	}

	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		require.NoError(t, keylinesqlite.Init(t.Context(), conn))
		for _, table := range []string{T_KeylineNodes, T_KeylineDelegations, T_KeylineRevocations, T_KeylineMembers} {
			count, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM "+table)
			require.NoError(t, err)
			require.Zero(t, count, "migration must leave %s for synchronous backfill", table)
		}

		for _, table := range []string{T_Blobs, T_StructuralBlobs, T_Resources, T_Fts, T_Embeddings, T_EmbeddingsIndex, T_RbsrItem} {
			count, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM "+table)
			require.NoError(t, err)
			require.Equal(t, 1, count, "%s must be preserved", table)
		}

		blob, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM blobs WHERE id = 1 AND multihash = X'0102' AND codec = 113 AND size = 4 AND data = X'DEADBEEF'")
		require.NoError(t, err)
		require.Equal(t, 1, blob, "blob identity and bytes must be preserved")

		for key, want := range map[string]string{"last_reindex_time": "already-indexed", "unrelated": "preserved"} {
			value, err := GetKV(t.Context(), conn, key)
			require.NoError(t, err)
			require.Equal(t, want, value)
		}

		marker, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM kv WHERE key = 'keyline_projection_version'")
		require.NoError(t, err)
		require.Zero(t, marker)
		scopes, err := sqlitex.QueryOne[int](conn, "SELECT count(*) FROM rbsr_scope WHERE materialized = 0 AND ((id = 1 AND last_access = 123) OR (id = 2 AND last_access = 456))")
		require.NoError(t, err)
		require.Equal(t, 2, scopes, "scope identity and last access must survive stale-marking")
		return nil
	}))

	// A retried migration also preserves an already populated projection,
	// including reference-only identities.
	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		return sqlitex.ExecScript(conn, `
			INSERT INTO keyline_nodes (id, name, blob_id, ts, blob_key)
			VALUES (1, 'subject', 1, -1, 'opaque-blob'), (2, 'member', NULL, NULL, NULL), (3, 'epoch', 1, 0, 'opaque-blob');
			INSERT INTO keyline_delegations (id, issuer, audience, subject, power, blob_id)
			VALUES ('delegation', 1, 2, 1, 'a', 1);
			INSERT INTO keyline_revocations (id, issuer, target, blob_id) VALUES ('revocation', 1, 'missing-target', 1);
			INSERT INTO keyline_members (subject, member, power) VALUES (1, 2, 'a');
		`)
	}))
	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		return migrations[idx].Run(nil, conn)
	}))
	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		for _, query := range []string{
			"SELECT count(*) FROM keyline_nodes WHERE id = 1 AND name = 'subject' AND blob_id = 1 AND ts = -1 AND blob_key = 'opaque-blob'",
			"SELECT count(*) FROM keyline_nodes WHERE id = 2 AND name = 'member' AND blob_id IS NULL AND ts IS NULL AND blob_key IS NULL",
			"SELECT count(*) FROM keyline_nodes WHERE id = 3 AND name = 'epoch' AND blob_id = 1 AND ts = 0 AND blob_key = 'opaque-blob'",
			"SELECT count(*) FROM keyline_delegations WHERE id = 'delegation' AND issuer = 1 AND audience = 2 AND subject = 1 AND power = 'a' AND blob_id = 1",
			"SELECT count(*) FROM keyline_revocations WHERE id = 'revocation' AND issuer = 1 AND target = 'missing-target' AND blob_id = 1",
			"SELECT count(*) FROM keyline_members WHERE subject = 1 AND member = 2 AND power = 'a'",
		} {
			count, err := sqlitex.QueryOne[int](conn, query)
			require.NoError(t, err)
			require.Equal(t, 1, count, query)
		}

		return nil
	}))
}

func TestRBSRRepairMigrationDoesNotScheduleReindex(t *testing.T) {
	db := MakeTestMemoryDB(t)
	conn, release, err := db.WriteConn(context.Background())
	require.NoError(t, err)
	defer release()

	reindexTime := "already-indexed"
	require.NoError(t, SetKV(context.Background(), conn, "last_reindex_time", reindexTime, true))

	idx := slices.IndexFunc(migrations, func(m migration) bool {
		return m.Version == "2026-08-05.103117"
	})
	require.NotEqual(t, -1, idx, "RBSR repair migration must exist")
	require.NoError(t, migrations[idx].Run(nil, conn))

	got, err := sqlitex.QueryOne[string](conn, "SELECT value FROM kv WHERE key = 'last_reindex_time'")
	require.NoError(t, err)
	require.Equal(t, reindexTime, got)

	for _, table := range []string{"rbsr_scope", "rbsr_item"} {
		exists, err := sqlitex.QueryOne[int64](conn, "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?", table)
		require.NoError(t, err)
		require.Equal(t, int64(1), exists, "%s must exist", table)
	}
}

func TestMigrationListSorted(t *testing.T) {
	require.True(t, slices.IsSortedFunc(migrations, func(a, b migration) int {
		return strings.Compare(a.Version, b.Version)
	}), "the list of migrations must be sorted")

	out := slices.CompactFunc(migrations, func(a, b migration) bool {
		return a.Version == b.Version
	})
	if len(out) != len(migrations) {
		t.Fatalf("the list of migrations must not contain duplicates: %v", migrations)
	}
}

func copyDir(src, dst string) error {
	src = strings.TrimPrefix(src, "./")
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		dstPath := strings.Replace(path, src, dst, 1)

		if info.IsDir() {
			return os.MkdirAll(dstPath, 0750)
		}

		return copyFile(path, dstPath)
	})
}

func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	if err != nil {
		return err
	}

	return dstFile.Sync()
}

func TestMigrations_GenerateGoldenSnapshot(t *testing.T) {
	// This is the same as TestMigrationsOnInitialSnapshot, but it generates a new golden snapshot,
	// before running the test.
	// Normally we only need to use this when we make a breaking database change and we want to regenerate the snapshot.
	testutil.Manual(t)

	generateGoldenSnapshot()
	runMigrationsTest(t)
}
