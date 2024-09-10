package main

import (
	"context"
	"errors"
	"flag"
	"os"
	"slices"
	"time"

	_ "expvar"
	_ "net/http/pprof"

	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/daemon"
	"seed/backend/logging"
	"seed/backend/storage"

	"github.com/burdiyan/go/mainutil"
	"github.com/getsentry/sentry-go"
	"github.com/peterbourgon/ff/v4"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

func main() {
	const envVarPrefix = "SEED"

	mainutil.Run(func() error {
		ctx := mainutil.TrapSignals()

		fs := flag.NewFlagSet("seed-daemon", flag.ExitOnError)

		cfg := config.Default()
		cfg.BindFlags(fs)

		err := ff.Parse(fs, slices.Clone(os.Args[1:]), ff.WithEnvVarPrefix(envVarPrefix))
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

		log := logging.New("seed-daemon", cfg.LogLevel)
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
				daemon.GRPCDebugLoggingInterceptor(),
			)),
			daemon.WithGRPCServerOption(grpc.ChainStreamInterceptor(
				otelgrpc.StreamServerInterceptor(),
			)),
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
