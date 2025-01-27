package main

import (
	"context"
	"errors"
	"flag"
	"os"
	"slices"
	"strings"
	"time"

	_ "expvar"
	_ "net/http/pprof"

	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/daemon"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/grpcprom"

	"github.com/burdiyan/go/mainutil"
	"github.com/getsentry/sentry-go"
	"github.com/peterbourgon/ff/v4"
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

func main() {
	const envVarPrefix = "SEED"

	mainutil.Run(func() error {
		ctx := mainutil.TrapSignals()

		fs := flag.NewFlagSet("seed-daemon", flag.ExitOnError)

		cfg := config.Default()
		cfg.BindFlags(fs)

		// Each of our config flags can already be specified with a dedicated environment variable.
		// The problem is that we won't have any errors in case of a typo in the environment variable name.
		// Sometimes it matters, so we also define a single environment variable into which you can put all the flags at once,
		// which is useful for situations where you can't directly provide them in the command line.
		// Flags in this environment variables will be merged with the ones provided in the command line,
		// with the explicitly provided ones taking precedence.
		args := slices.Clone(os.Args[1:])
		if envflags := os.Getenv("SEED_DAEMON_FLAGS"); envflags != "" {
			args = slices.Concat(strings.Split(envflags, " "), args)
		}

		err := ff.Parse(fs, args, ff.WithEnvVarPrefix(envVarPrefix))
		if err != nil {
			if errors.Is(err, ff.ErrHelp) {
				fs.Usage()
				return nil
			}

			return err
		}

		if err := cfg.Base.ExpandDataDir(); err != nil {
			return err
		}

		log := logging.New("seed/daemon", cfg.LogLevel)
		if err := sentry.Init(sentry.ClientOptions{}); err != nil {
			log.Debug("SentryInitError", zap.Error(err))
		} else {
			defer sentry.Flush(2 * time.Second)
		}

		keyStoreEnvironment := cfg.P2P.TestnetName
		if keyStoreEnvironment == "" {
			keyStoreEnvironment = "main"
		}
		ks := core.NewOSKeyStore(keyStoreEnvironment)

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
	})
}
