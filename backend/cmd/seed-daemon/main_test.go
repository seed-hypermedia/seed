package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"seed/backend/config"
	"seed/backend/storage"

	"github.com/stretchr/testify/require"
)

// clearSeedEnv unsets every SEED_* environment variable for the duration of the test,
// because the dev environment exports some of them, and they would set daemon flags.
func clearSeedEnv(t *testing.T) {
	t.Helper()

	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		if strings.HasPrefix(k, envVarPrefix+"_") {
			t.Setenv(k, "") // Registers the cleanup that restores the original value.
			require.NoError(t, os.Unsetenv(k))
		}
	}
}

// runRoot runs the command line and returns the config the daemon would have started with,
// or nil if the daemon wasn't started.
func runRoot(t *testing.T, args []string, envFlags string) (*config.Config, string, error) {
	t.Helper()

	var (
		got  *config.Config
		help bytes.Buffer
	)

	err := run(args, envFlags, &help, func(cfg config.Config) error {
		got = &cfg
		return nil
	})

	return got, help.String(), err
}

func TestRootRunsDaemonWithFlags(t *testing.T) {
	clearSeedEnv(t)

	// The flags the desktop app passes, in the forms it uses.
	cfg, _, err := runRoot(t, []string{
		"-http.port=56001",
		"-grpc.port=56002",
		"-p2p.port=56000",
		"-lndhub.mainnet=true",
		"-p2p.testnet-name", "dev",
		"-data-dir=/tmp/seed-daemon-test",
		"-llm.embedding.enabled",
	}, "")
	require.NoError(t, err)
	require.NotNil(t, cfg, "daemon must run when no subcommand is given")

	require.Equal(t, 56001, cfg.HTTP.Port)
	require.Equal(t, 56002, cfg.GRPC.Port)
	require.Equal(t, 56000, cfg.P2P.Port)
	require.Equal(t, "dev", cfg.P2P.TestnetName)
	require.Equal(t, "/tmp/seed-daemon-test", cfg.Base.DataDir)
	require.True(t, cfg.LLM.Embedding.Enabled)
}

func TestRootRunsDaemonWithDefaults(t *testing.T) {
	clearSeedEnv(t)

	cfg, _, err := runRoot(t, nil, "")
	require.NoError(t, err)
	require.NotNil(t, cfg)

	// Bootstrap peers come out of a map, so their order differs even between two Default() calls.
	want := config.Default()
	require.ElementsMatch(t, want.P2P.BootstrapPeers, cfg.P2P.BootstrapPeers)
	want.P2P.BootstrapPeers, cfg.P2P.BootstrapPeers = nil, nil
	require.Equal(t, want, *cfg)
}

func TestRootFlagSources(t *testing.T) {
	clearSeedEnv(t)
	t.Setenv("SEED_HTTP_PORT", "57001")
	t.Setenv("SEED_GRPC_PORT", "57002")

	// Command line beats SEED_DAEMON_FLAGS, which beats the dedicated env vars.
	cfg, _, err := runRoot(t, []string{"-grpc.port=59002"}, "  -grpc.port=58002   -log-level=debug  -http.port=58001 ")
	require.NoError(t, err)
	require.NotNil(t, cfg)

	require.Equal(t, 58001, cfg.HTTP.Port)
	require.Equal(t, 59002, cfg.GRPC.Port)
	require.Equal(t, "debug", cfg.Base.LogLevel)
}

func TestRootRejectsPositionalArgs(t *testing.T) {
	clearSeedEnv(t)

	cfg, _, err := runRoot(t, []string{"-data-dir=/tmp/x", "reindx"}, "")
	require.ErrorContains(t, err, `unknown subcommand "reindx"`)
	require.Nil(t, cfg, "daemon must not start on a mistyped subcommand")
}

// Deployments have long passed the site URL as a trailing argument, and the daemon ignored it.
// It must still start (2026.11.8 refused it and every such site crash-looped).
func TestRootIgnoresTrailingSiteURL(t *testing.T) {
	clearSeedEnv(t)

	cfg, help, err := runRoot(t, []string{"-data-dir=/tmp/x", "-http.port=56000", "https://hyper.media"}, "")
	require.NoError(t, err)
	require.NotNil(t, cfg, "daemon must start despite a trailing site URL")
	require.Equal(t, 56000, cfg.HTTP.Port)
	require.Contains(t, help, `ignoring positional argument "https://hyper.media"`)
}

func TestRootRejectsWordAfterURL(t *testing.T) {
	clearSeedEnv(t)

	cfg, _, err := runRoot(t, []string{"https://hyper.media", "reindx"}, "")
	require.ErrorContains(t, err, `unknown subcommand "reindx"`)
	require.Nil(t, cfg)
}

func TestRootRejectsUnknownFlag(t *testing.T) {
	clearSeedEnv(t)

	cfg, _, err := runRoot(t, []string{"-no-such-flag"}, "")
	require.ErrorContains(t, err, "unknown flag")
	require.Nil(t, cfg)
}

func TestRootHelp(t *testing.T) {
	clearSeedEnv(t)

	cfg, help, err := runRoot(t, []string{"-help"}, "")
	require.NoError(t, err)
	require.Nil(t, cfg, "help must not start the daemon")
	require.Contains(t, help, "SUBCOMMANDS")
	require.Contains(t, help, "reindex")
	require.Contains(t, help, "-data-dir")
}

func TestReindexInheritsDaemonFlags(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "uninitialized")

	cases := map[string]struct {
		args     []string
		envFlags string
		env      string
	}{
		"after subcommand":  {args: []string{"reindex", "-data-dir", dir}},
		"before subcommand": {args: []string{"-data-dir", dir, "reindex"}},
		"SEED_DAEMON_FLAGS": {args: []string{"reindex"}, envFlags: "-data-dir=" + dir},
		"SEED_DATA_DIR":     {args: []string{"reindex"}, env: dir},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			clearSeedEnv(t)

			if tc.env != "" {
				t.Setenv("SEED_DATA_DIR", tc.env)
			}

			cfg, _, err := runRoot(t, tc.args, tc.envFlags)
			require.Nil(t, cfg, "reindex must not start the daemon")
			// An uninitialized data dir proves the subcommand got the right path without touching anything.
			require.ErrorContains(t, err, dir)
			require.ErrorContains(t, err, "not initialized")
			require.NoDirExists(t, dir)
		})
	}
}

func TestReindexRequiresExplicitDataDir(t *testing.T) {
	clearSeedEnv(t)

	cfg, _, err := runRoot(t, []string{"reindex"}, "")
	require.Nil(t, cfg, "reindex must not start the daemon")
	require.ErrorContains(t, err, "data directory must be given explicitly")
}

func TestSQLDatabasePath(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "db"), 0o700))
	require.NoError(t, os.WriteFile(storage.SQLitePath(dir), nil, 0o600))

	base := config.Base{DataDir: dir}

	cases := map[string]struct {
		args       []string
		dataDirSet bool
		want       string
		wantErr    string
	}{
		"default is in-memory":           {want: ":memory:"},
		"explicit data dir":              {dataDirSet: true, want: storage.SQLitePath(dir)},
		"database argument":              {args: []string{"some.db"}, want: "some.db"},
		"explicit in-memory argument":    {args: []string{":memory:"}, want: ":memory:"},
		"argument and explicit data dir": {args: []string{"some.db"}, dataDirSet: true, wantErr: "not both"},
		"too many arguments":             {args: []string{"a.db", "b.db"}, wantErr: "at most one"},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := sqlDatabasePath(tc.args, base, tc.dataDirSet)
			if tc.wantErr != "" {
				require.ErrorContains(t, err, tc.wantErr)
				return
			}

			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}
}

func TestSQLDetectsExplicitDataDir(t *testing.T) {
	// A data dir without a database fails before the shell starts,
	// which proves the data dir was detected as explicit without running the REPL.
	dir := filepath.Join(t.TempDir(), "empty")

	cases := map[string]struct {
		args     []string
		envFlags string
		env      string
	}{
		"after subcommand":  {args: []string{"sql", "-data-dir", dir}},
		"before subcommand": {args: []string{"-data-dir", dir, "sql"}},
		"SEED_DAEMON_FLAGS": {args: []string{"sql"}, envFlags: "-data-dir=" + dir},
		"SEED_DATA_DIR":     {args: []string{"sql"}, env: dir},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			clearSeedEnv(t)

			if tc.env != "" {
				t.Setenv("SEED_DATA_DIR", tc.env)
			}

			cfg, _, err := runRoot(t, tc.args, tc.envFlags)
			require.Nil(t, cfg, "sql must not start the daemon")
			require.ErrorContains(t, err, "no database in data directory")
			require.ErrorContains(t, err, dir)
			require.NoDirExists(t, dir, "sql must not create anything in the data directory")
		})
	}
}
