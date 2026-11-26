package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	_ "expvar"
	_ "net/http/pprof"

	_ "github.com/grafana/pyroscope-go/godeltaprof/http/pprof"
	_ "golang.org/x/net/trace"

	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/core/keystore"
	"seed/backend/daemon"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/storage/vault"
	"seed/backend/util/grpcprom"
	"seed/backend/util/pprofx"

	"github.com/burdiyan/go/mainutil"
	"github.com/getsentry/sentry-go"
	"github.com/peterbourgon/ff/v4"
	"github.com/peterbourgon/ff/v4/ffhelp"
	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

var (
	grpcServerMetrics = grpcprom.NewServerMetrics("seed", "daemon")
)

func init() {
	prometheus.MustRegister(grpcServerMetrics)
}

// envVarPrefix is the prefix of the environment variables that set flags, e.g. SEED_DATA_DIR for -data-dir.
const envVarPrefix = "SEED"

func main() {
	pprofx.UseRecommendedSettings()

	mainutil.Run(func() error {
		return run(os.Args[1:], os.Getenv("SEED_DAEMON_FLAGS"), os.Stderr, runDaemon)
	})
}

// run parses the command line and runs the selected command.
// envFlags is the value of SEED_DAEMON_FLAGS. Help goes to helpOut.
// runDaemon is called when no subcommand is selected. It's a parameter so tests can check the parsed config.
func run(args []string, envFlags string, helpOut io.Writer, runDaemon func(config.Config) error) error {
	cfg := config.Default()
	stdfs := flag.NewFlagSet("seed-daemon", flag.ContinueOnError)
	cfg.BindFlags(stdfs)
	rootFlags := ff.NewFlagSetFrom(stdfs.Name(), stdfs)

	root := &ff.Command{
		Name:      "seed-daemon",
		Usage:     "seed-daemon [FLAGS] [SUBCOMMAND [FLAGS]]",
		ShortHelp: "Run the Seed daemon, or a maintenance subcommand on its data directory.",
		Flags:     rootFlags,
		Subcommands: []*ff.Command{
			newReindexCmd(&cfg, rootFlags),
			newSQLCmd(&cfg, rootFlags),
		},
		Exec: func(_ context.Context, args []string) error {
			// The daemon takes no positional arguments, so anything left is most likely a mistyped subcommand.
			// Except a URL, which no subcommand name looks like: every deployment template (ops/docker-compose.yml,
			// the hosted gateways) has long passed the site URL last, and the daemon always ignored it. Refusing it
			// took every one of those sites down, so it is still ignored, with a warning.
			for _, arg := range args {
				if !strings.Contains(arg, "://") {
					return fmt.Errorf("unknown subcommand %q: run 'seed-daemon -help' for the list of subcommands", arg)
				}
			}

			for _, arg := range args {
				_, _ = fmt.Fprintf(helpOut, "seed-daemon: ignoring positional argument %q: the daemon takes none\n", arg)
			}

			return runDaemon(cfg)
		},
	}

	// Each of our config flags can already be specified with a dedicated environment variable.
	// The problem is that we won't have any errors in case of a typo in the environment variable name.
	// Sometimes it matters, so we also define a single environment variable into which you can put all the flags at once,
	// which is useful for situations where you can't directly provide them in the command line.
	// Flags in this environment variables will be merged with the ones provided in the command line,
	// with the explicitly provided ones taking precedence.
	// They go before the subcommand name, so subcommands see them too, since they inherit the daemon flags.
	// Fields rather than Split: stray spaces would produce empty positional arguments.
	args = slices.Concat(strings.Fields(envFlags), args)

	if err := root.Parse(args, ff.WithEnvVarPrefix(envVarPrefix)); err != nil {
		if errors.Is(err, ff.ErrHelp) {
			_, _ = ffhelp.Command(root.GetSelected()).WriteTo(helpOut)
			return nil
		}

		return err
	}

	// Each command decides on its own signal handling, so no context from here.
	return root.Run(context.Background())
}

// runDaemon runs the daemon until it fails or receives a termination signal.
func runDaemon(cfg config.Config) error {
	ctx := mainutil.TrapSignals()

	if err := cfg.Base.ExpandDataDir(); err != nil {
		return err
	}

	log := logging.New("seed/daemon", cfg.LogLevel)
	if err := sentry.Init(sentry.ClientOptions{}); err != nil {
		log.Debug("SentryInitError", zap.Error(err))
	} else {
		defer sentry.Flush(2 * time.Second)
	}

	var ks core.KeyStore

	if cfg.Base.VaultMemorySecrets {
		secrets, err := vault.NewMemorySecretStore()
		if err != nil {
			return err
		}

		ks, err = vault.New(cfg.Base.DataDir, secrets)
		if err != nil {
			return fmt.Errorf("failed to create vault keystore with memory secrets: %w", err)
		}

		log.Info("UsingLocalVaultKeyStoreWithMemorySecrets")
	} else if cfg.Base.KeystoreDir != "" {
		var err error

		ks, err = keystore.NewFile(cfg.Base.KeystoreDir)
		if err != nil {
			return fmt.Errorf("failed to create file keystore: %w", err)
		}

		log.Info("UsingFileKeyStore", zap.String("dir", cfg.Base.KeystoreDir))
	} else {
		keyStoreEnvironment := cfg.P2P.TestnetName
		if keyStoreEnvironment == "" {
			keyStoreEnvironment = "main"
		}

		var err error

		ks, err = vault.NewProduction(cfg.Base.DataDir, keyStoreEnvironment)
		if err != nil {
			return fmt.Errorf("failed to create production keystore: %w", err)
		}

		log.Info("UsingLocalVaultKeyStore", zap.String("path", filepath.Join(cfg.Base.DataDir, "vault.json")))
	}

	dir, err := storage.Open(cfg.Base.DataDir, nil, ks, cfg.LogLevel)
	if err != nil {
		return err
	}
	defer dir.Close()

	app, err := daemon.Load(ctx, cfg, dir,
		daemon.WithGRPCServerOption(grpc.ChainUnaryInterceptor(
			otelgrpc.UnaryServerInterceptor(),
			grpcServerMetrics.UnaryServerInterceptor(),
		)),
		daemon.WithGRPCServerOption(grpc.ChainStreamInterceptor(
			otelgrpc.StreamServerInterceptor(),
			grpcServerMetrics.StreamServerInterceptor(),
		)),
		daemon.WithGRPCServerOption(grpc.StatsHandler(grpcServerMetrics)),
	)
	if err != nil {
		return err
	}

	err = app.Wait()
	if errors.Is(err, context.Canceled) {
		return nil
	}

	return err
}
