package atomicfile

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWriteFileCreatesAndOverwritesFile(t *testing.T) {
	dir := t.TempDir()
	filename := filepath.Join(dir, "vault.json")

	require.NoError(t, WriteFile(filename, []byte("first"), 0600))
	data := mustReadFile(t, filename)
	require.Equal(t, "first", string(data))
	assertFileMode(t, filename, 0600)

	require.NoError(t, WriteFile(filename, []byte("second"), 0640))
	data = mustReadFile(t, filename)
	require.Equal(t, "second", string(data))
	assertFileMode(t, filename, 0640)
}

func TestWriteFileCleansTempFileWhenRenameFails(t *testing.T) {
	dir := t.TempDir()
	targetDir := filepath.Join(dir, "vault.json")
	require.NoError(t, os.Mkdir(targetDir, 0700))

	err := WriteFile(targetDir, []byte("payload"), 0600)
	require.Error(t, err)

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, entry := range entries {
		require.False(t, strings.HasPrefix(entry.Name(), "vault.json.tmp"), "unexpected temp file left behind: %s", entry.Name())
	}
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()

	data, err := os.ReadFile(path)
	require.NoError(t, err)
	return data
}

func assertFileMode(t *testing.T, path string, expected os.FileMode) {
	t.Helper()

	if runtime.GOOS == "windows" {
		return
	}

	info, err := os.Stat(path)
	require.NoError(t, err)
	require.Equal(t, expected, info.Mode().Perm())
}
