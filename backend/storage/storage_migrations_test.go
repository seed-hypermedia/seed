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
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/testutil"
	"seed/backend/util/must"
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

	dir, err := Open(cfg.Base.DataDir, alice.Device.Wrapped(), core.NewMemoryKeyStore(), cfg.LogLevel)
	if err != nil {
		panic(err)
	}
	defer dir.Close()

	fmt.Println("Database has been saved in:", cfg.Base.DataDir)
	if errors.Is(err, context.Canceled) {
		panic("error unexpected " + err.Error())
	}

	if err != nil {
		panic(err)
	}
}

func runMigrationsTest(t *testing.T) {
	migrateDir := t.TempDir()
	err := copyDir(snapshotDataDir, migrateDir)
	require.NoError(t, err)

	alice := coretest.NewTester("alice")

	migratedStore, err := Open(migrateDir, alice.Device.Wrapped(), core.NewMemoryKeyStore(), "debug")
	require.NoError(t, err)
	require.NoError(t, migratedStore.Migrate())
	defer migratedStore.Close()

	freshStore, err := Open(t.TempDir(), alice.Device.Wrapped(), core.NewMemoryKeyStore(), "debug")
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
	}

	// We want to check that the version file matches the version of the last migration.
	require.Equal(t, migrations[len(migrations)-1].Version, must.Do2(readVersionFile(migratedStore.path)))
	require.Equal(t, migrations[len(migrations)-1].Version, must.Do2(readVersionFile(freshStore.path)))
}

func getRawSQLSchema(t *testing.T, db *sqlitex.Pool) map[string]string {
	out := make(map[string]string) // table to sql.
	conn, release, err := db.Conn(context.Background())
	require.NoError(t, err)
	defer release()

	rows, check := sqlitex.Query(conn, "select name, sql from sqlite_schema order by name")
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
