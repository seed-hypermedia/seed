package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/testutil"
	"seed/backend/util/must"
	"seed/backend/util/sqlitedbg"
	"seed/backend/util/sqlitegen"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/exp/slices"
)

const snapshotDataDir = "./testdata/seed-test-db-snapshot"

func TestMigrations_GenerateGoldenSnapshot(t *testing.T) {
	// This is the same as TestMigrationsOnInitialSnapshot, but it generates a new golden snapshot,
	// before running the test.
	testutil.Manual(t)

	generateGoldenSnapshot()
	runMigrationsTest(t)
}

func TestMigrationsOnInitialSnapshot(t *testing.T) {
	t.Cleanup(func() {
		if t.Failed() {
			t.Log("======= README =======")
			t.Log("Maybe you want to regenerate the golden database snapshot?")
			t.Log("If so, run the TestMigrations_GenerateGoldenSnapshot manually from your IDE.")
			t.Log("Or run it from the command line with: 'go test ./backend/storage -run TestMigrations_GenerateGoldenSnapshot'.")
		}
	})
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
	tmpDir := t.TempDir()
	err := copyDir(snapshotDataDir, tmpDir)
	require.NoError(t, err)

	alice := coretest.NewTester("alice")

	oldDir, err := Open(tmpDir, alice.Device.Wrapped(), core.NewMemoryKeyStore(), "debug")
	require.NoError(t, err)
	require.NoError(t, oldDir.Migrate())
	defer oldDir.Close()

	newDir, err := Open(t.TempDir(), alice.Device.Wrapped(), core.NewMemoryKeyStore(), "debug")
	require.NoError(t, err)
	require.NoError(t, newDir.Migrate())
	defer newDir.Close()

	oldDB, newDB := oldDir.db, newDir.db

	oldSchema, err := sqlitegen.IntrospectSchema(oldDB)
	require.NoError(t, err)

	newSchema, err := sqlitegen.IntrospectSchema(newDB)
	require.NoError(t, err)

	require.Equal(t, oldSchema, newSchema)

	var (
		oldSQL bytes.Buffer
		newSQL bytes.Buffer
	)

	sqlitedbg.Exec(oldDB, &oldSQL, "select sql from sqlite_schema order by name")
	sqlitedbg.Exec(newDB, &newSQL, "select sql from sqlite_schema order by name")
	require.Equal(t, oldSQL.String(), newSQL.String())

	// We want to check that the version file matches the version of the last migration.
	require.Equal(t, migrations[len(migrations)-1].Version, must.Do2(readVersionFile(oldDir.path)))
	require.Equal(t, migrations[len(migrations)-1].Version, must.Do2(readVersionFile(newDir.path)))
}

func TestMigrationList(t *testing.T) {
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
