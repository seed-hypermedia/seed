// Package daemon provides the entrypoint initialization code to boot the seed-daemon program.
// It's like package main, but made as separate package
// to be importable and testable by other packages.
// That's because package main is not importable.
package daemon

import (
	"context"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"seed/backend/api"
	activity "seed/backend/api/activity/v1alpha"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	"seed/backend/logging"
	"seed/backend/mttnet"
	"seed/backend/syncing"
	"seed/backend/util/cleanup"
	"seed/backend/util/future"
	"seed/backend/wallet"

	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/boxo/exchange"
	"github.com/ipfs/boxo/exchange/offline"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/multierr"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

func init() {
	// See https://github.com/libp2p/go-libp2p/issues/2968, and https://github.com/golang/go/issues/69312.
	// At some point we won't need this.
	os.Setenv("GODEBUG", "asynctimerchan=1")
}

// App is the main Seed Daemon application, holding all of its dependencies
// which can be used for embedding the daemon in other apps or for testing.
type App struct {
	clean cleanup.Stack
	g     *errgroup.Group

	log *zap.Logger

	Storage      Storage
	HTTPListener net.Listener
	HTTPServer   *http.Server
	GRPCListener net.Listener
	GRPCServer   *grpc.Server
	RPC          api.Server
	Net          *mttnet.Node
	Syncing      *syncing.Service
	Index        *blob.Index
	Wallet       *wallet.Service
}

type options struct {
	extraHTTPHandlers []func(*Router)
	extraP2PServices  []func(grpc.ServiceRegistrar)
	grpc              grpcOpts
}

type grpcOpts struct {
	serverOptions []grpc.ServerOption
	extraServices []func(grpc.ServiceRegistrar)
}

// Option is a function that can be passed to Load to configure the app.
type Option func(*options)

// WithHTTPHandler add an extra HTTP handler to the app's HTTP server.
func WithHTTPHandler(route string, h http.Handler, mode int) Option {
	return func(o *options) {
		o.extraHTTPHandlers = append(o.extraHTTPHandlers, func(r *Router) {
			r.Handle(route, h, mode)
		})
	}
}

// WithP2PService adds an extra gRPC service to the P2P node.
func WithP2PService(fn func(grpc.ServiceRegistrar)) Option {
	return func(o *options) {
		o.extraP2PServices = append(o.extraP2PServices, fn)
	}
}

// WithGRPCServerOption adds an extra gRPC server option to the daemon gRPC server.
func WithGRPCServerOption(opt grpc.ServerOption) Option {
	return func(o *options) {
		o.grpc.serverOptions = append(o.grpc.serverOptions, opt)
	}
}

type Storage interface {
	DB() *sqlitex.Pool
	KeyStore() core.KeyStore
	Migrate() error
	Device() core.KeyPair
}

// Load all of the dependencies for the app, and start
// all the background goroutines.
//
// Most of the complexity here is due to our lazy initialization
// process. We need to startup every component and make it ready,
// even though in the beginning we don't have some of the prerequisites
// like the Seed Account key. To mitigate this we're using futures
// which are resolved after the account is initialized.
//
// After Load returns without errors, the App is ready to use, although
// futures might not be resolved yet.
//
// To shut down the app gracefully cancel the provided context and call Wait().
func Load(ctx context.Context, cfg config.Config, r Storage, oo ...Option) (a *App, err error) {
	a = &App{
		log:     logging.New("seed/daemon", cfg.LogLevel),
		Storage: r,
	}
	a.g, ctx = errgroup.WithContext(ctx)

	var opts options
	for _, opt := range oo {
		opt(&opts)
	}

	// If errors occurred during loading, we need to close everything
	// we managed to initialize so far, and wait for all the goroutines
	// to finish. If everything booted correctly, we need to close the cleanup stack
	// when the context is canceled, so the app is shut down gracefully.
	defer func(a *App) {
		if err != nil {
			err = multierr.Combine(
				err,
				a.clean.Close(),
				a.g.Wait(),
			)
		} else {
			a.g.Go(func() error {
				<-ctx.Done()
				return a.clean.Close()
			})
		}
	}(a)

	tp := trace.NewTracerProvider(
		trace.WithSampler(trace.AlwaysSample()),
	)
	a.clean.AddErrFunc(func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return tp.Shutdown(ctx)
	})

	otel.SetTracerProvider(tp)

	a.Index = blob.NewIndex(a.Storage.DB(), logging.New("seed/indexing", cfg.LogLevel), nil)

	a.Net, err = initNetwork(&a.clean, a.g, a.Storage, cfg.P2P, a.Index, cfg.LogLevel, opts.extraP2PServices...)
	if err != nil {
		return nil, err
	}
	a.Index.SetProvider(a.Net.Provider())
	activitySrv := activity.NewServer(a.Storage.DB(), logging.New("seed/activity", cfg.LogLevel), &a.clean)
	a.Syncing, err = initSyncing(cfg.Syncing, &a.clean, a.g, a.Storage.DB(), a.Index, a.Net, activitySrv, cfg.LogLevel)
	if err != nil {
		return nil, err
	}
	activitySrv.SetSyncer(a.Syncing)
	a.Wallet = wallet.New(ctx, logging.New("seed/wallet", cfg.LogLevel), a.Storage.DB(), a.Net, cfg.Lndhub.Mainnet)

	a.GRPCServer, a.GRPCListener, a.RPC, err = initGRPC(ctx, cfg.GRPC.Port, &a.clean, a.g, a.Storage, a.Index, a.Net,
		a.Syncing,
		activitySrv,
		cfg.LogLevel, opts.grpc)
	if err != nil {
		return nil, err
	}
	a.Syncing.SetDocGetter(a.RPC.DocumentsV3)
	var fm *mttnet.FileManager
	{
		bs := a.Index.IPFSBlockstore()
		var e exchange.Interface = a.Net.Bitswap()
		if cfg.Syncing.NoDiscovery {
			e = offline.Exchange(bs)
		}

		fm = mttnet.NewFileManager(logging.New("seed/file-manager", cfg.LogLevel), bs, e, a.Net.Provider())
	}

	opts.extraHTTPHandlers = append(opts.extraHTTPHandlers, func(r *Router) {
		r.Handle("/debug/p2p", a.Net.DebugHandler(), RouteNav)
	})

	a.HTTPServer, a.HTTPListener, err = initHTTP(cfg.HTTP.Port, a.GRPCServer, &a.clean, a.g, a.Index,
		a.Wallet,
		fm, opts.extraHTTPHandlers...)
	if err != nil {
		return nil, err
	}

	a.setupLogging(ctx, cfg)

	// TODO(hm24): groups are dead.
	// if !cfg.Syncing.NoPull {
	// 	a.g.Go(func() error {
	// 		return a.RPC.Groups.StartPeriodicSync(ctx, cfg.Syncing.WarmupDuration, cfg.Syncing.Interval, false)
	// 	})
	// }

	return
}

type lazyFileManager struct {
	fm future.Value[*mttnet.FileManager]
}

func (l *lazyFileManager) GetFile(w http.ResponseWriter, r *http.Request) {
	fm, err := l.fm.Await(r.Context())
	if err != nil {
		http.Error(w, "File manager is not ready yet", http.StatusPreconditionFailed)
		return
	}

	fm.GetFile(w, r)
}

func (l *lazyFileManager) UploadFile(w http.ResponseWriter, r *http.Request) {
	fm, err := l.fm.Await(r.Context())
	if err != nil {
		http.Error(w, "File manager is not ready yet", http.StatusPreconditionFailed)
		return
	}

	fm.UploadFile(w, r)
}

func (a *App) setupLogging(ctx context.Context, cfg config.Config) {
	logging.SetLogLevel("provider.batched", "debug")
	logging.SetLogLevel("p2p-holepunch", "debug")
	logging.SetLogLevel("autorelay", "debug")
	logging.SetLogLevel("autonat", "info")
	logging.SetLogLevel("autonatv2", "info")
	logging.SetLogLevel("p2p-circuit", "debug")
	logging.SetLogLevel("relay", "debug")

	a.g.Go(func() error {
		a.log.Info("DaemonStarted",
			zap.String("grpcListener", a.GRPCListener.Addr().String()),
			zap.String("httpListener", a.HTTPListener.Addr().String()),
			zap.String("dataDir", cfg.DataDir),
		)

		n := a.Net

		select {
		case <-n.Ready():
		case <-ctx.Done():
			return ctx.Err()
		}

		a.log.Info("P2PNodeReady")

		return nil
	})

	a.clean.AddErrFunc(func() error {
		a.log.Info("GracefulShutdownStarted")
		a.log.Debug("Press ctrl+c again to force quit, but it's better to wait :)")
		return nil
	})
}

// Wait will block until the app is shut down.
func (a *App) Wait() error {
	return a.g.Wait()
}

func initNetwork(
	clean *cleanup.Stack,
	g *errgroup.Group,
	store Storage,
	cfg config.P2P,
	index *blob.Index,
	LogLevel string,
	extraServers ...func(grpc.ServiceRegistrar),
) (*mttnet.Node, error) {
	started := make(chan struct{})
	done := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	clean.AddErrFunc(func() error {
		cancel()
		// Wait until the network fully stops if it was ever started.
		select {
		case <-started:
			select {
			case <-done:
				return nil
			}
		default:
			return nil
		}
	})

	n, err := mttnet.New(cfg, store.Device(), store.KeyStore(), store.DB(), index, logging.New("seed/network", LogLevel))
	if err != nil {
		return nil, err
	}

	for _, svc := range extraServers {
		n.RegisterRPCService(svc)
	}

	g.Go(func() error {
		close(started)
		err := n.Start(ctx)
		close(done)
		return err
	})

	select {
	case <-n.Ready():
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	return n, nil
}

func initSyncing(
	cfg config.Syncing,
	clean *cleanup.Stack,
	g *errgroup.Group,
	db *sqlitex.Pool,
	indexer *blob.Index,
	node *mttnet.Node,
	sstore syncing.SubscriptionStore,
	LogLevel string,
) (*syncing.Service, error) {
	done := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	clean.AddErrFunc(func() error {
		cancel()
		<-done
		return nil
	})

	svc := syncing.NewService(cfg, logging.New("seed/syncing", LogLevel), db, indexer, node, sstore)
	if cfg.NoPull {
		close(done)
	} else {
		g.Go(func() error {
			err := svc.Start(ctx)
			close(done)
			return err
		})
	}

	return svc, nil
}

func initGRPC(
	ctx context.Context,
	port int,
	clean *cleanup.Stack,
	g *errgroup.Group,
	repo Storage,
	idx *blob.Index,
	node *mttnet.Node,
	sync *syncing.Service,
	activity *activity.Server,
	LogLevel string,
	opts grpcOpts,
) (srv *grpc.Server, lis net.Listener, rpc api.Server, err error) {
	lis, err = net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return
	}

	srv = grpc.NewServer(opts.serverOptions...)
	rpc = api.New(ctx, repo, idx, node, sync, activity, LogLevel)
	rpc.Register(srv)
	reflection.Register(srv)

	for _, extra := range opts.extraServices {
		extra(srv)
	}

	g.Go(func() error {
		return srv.Serve(lis)
	})

	clean.AddErrFunc(func() error {
		srv.GracefulStop()
		return nil
	})

	return
}

// WithMiddleware generates an grpc option with the given middleware.
func WithMiddleware(i grpc.UnaryServerInterceptor) grpc.ServerOption {
	return grpc.UnaryInterceptor(i)
}
