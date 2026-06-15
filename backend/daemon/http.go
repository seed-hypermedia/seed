package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"runtime/debug"
	daemonapi "seed/backend/api/daemon/v1alpha"
	telemetryapi "seed/backend/api/telemetry/v1alpha"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/hmnet"
	"seed/backend/logging"
	"seed/backend/util/cleanup"
	"seed/backend/util/ctxkey"
	"seed/backend/util/journeys"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/trcstats"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fullstorydev/grpcui"
	"github.com/fullstorydev/grpcui/standalone"
	"github.com/improbable-eng/grpc-web/go/grpcweb"
	"github.com/ipfs/boxo/blockstore"
	"github.com/ipfs/go-cid"
	"github.com/ipld/go-ipld-prime"
	"github.com/ipld/go-ipld-prime/codec/dagjson"
	"github.com/ipld/go-ipld-prime/multicodec"
	"github.com/peterbourgon/trc/eztrc"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"golang.org/x/exp/slices"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

var (
	commit string
	branch string
	date   string
)

func initHTTP(
	cfg config.Base,
	port int,
	rpc *grpc.Server,
	clean *cleanup.Stack,
	g *errgroup.Group,
	blobs blockstore.Blockstore,
	ipfsHandler *hmnet.FileManager,
	p2pnet *hmnet.Node,
	apiServer *daemonapi.Server,
	telemetrySrv *telemetryapi.Server,
) (srv *http.Server, lis net.Listener, err error) {
	router := &Router{mux: http.NewServeMux()}
	router.Use(
		openCORSMiddleware,
		authContextMiddleware(apiServer),
		publicOnlyMiddleware(cfg.PublicOnly),
		handlerNameMiddleware(router.mux),
		instrument,
		p2pnet.HTTPServerBW().Middleware(httpRequestTag),
	)

	{
		router.HandleFunc("POST /ipfs/file-upload", ipfsHandler.UploadFile)
		router.HandleFunc("POST /ipfs/{cid}", ipfsHandler.PutBlob)
		router.HandleFunc("GET /ipfs/{cid}", ipfsGetHandler(ipfsHandler.GetFile, makeBlobDAGJSONHandler(blobs)))

		loopback := router.With(loopbackOnly)
		loopback.HandleNav("GET /debug/metrics", promhttp.Handler())
		loopback.HandleNav("/debug/pprof/", http.DefaultServeMux)
		loopback.HandleNav("/debug/vars", http.DefaultServeMux)
		loopback.HandleNav("/debug/requests", http.DefaultServeMux)
		loopback.HandleNav("/debug/events", http.DefaultServeMux)
		loopback.HandleNav("/debug/buildinfo", buildInfoHandler())
		loopback.HandleNav("/debug/traces", trcstats.Handler(eztrc.Handler()))
		if telemetrySrv != nil {
			loopback.HandleNav("/debug/journeys", journeys.Handler(telemetrySrv))
		}
		loopback.HandleNav("/debug/logs", logging.DebugHandler())
		loopback.HandleNav("/debug/p2p", p2pnet.DebugHandler())
		loopback.HandleNav("/debug/network", p2pnet.NetworkDebugHandler())
		loopback.HandleNav("/debug/sqlite", sqlitex.DebugHandler())
		grpcUI, err := makeGRPCUIHandler(rpc, clean, g)
		if err != nil {
			return nil, nil, err
		}
		loopback.HandleNav("/debug/grpcui/", http.StripPrefix("/debug/grpcui", grpcUI))
		loopback.HandleFunc("/{$}", router.Index)

		router.HandleNav("GET /hm/api/config", p2pnet.HMAPIConfigHandler())
		router.HandleNav("GET /debug/version", gitVersionHandler())
		router.HandleFunc("/vault-connect", apiServer.HandleVaultConnect)

		router.Handle("/", grpcweb.WrapServer(rpc, grpcweb.WithOriginFunc(func(_ string) bool {
			return true
		})))
	}

	srv = &http.Server{
		Addr:              ":" + strconv.Itoa(port),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       20 * time.Second,
		Handler:           router,
	}

	lis, err = net.Listen("tcp", srv.Addr)
	if err != nil {
		return
	}

	g.Go(func() error {
		err := srv.Serve(lis)
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	})

	clean.AddErrFunc(func() error {
		return srv.Shutdown(context.Background())
	})

	return
}

// grpcUIMu serializes grpcui setup and request handling. The underlying proto
// printer has lazy-init fields on shared global descriptors that race under
// -race.
var grpcUIMu sync.Mutex

func makeGRPCUIHandler(rpc *grpc.Server, clean *cleanup.Stack, g *errgroup.Group) (http.Handler, error) {
	methods, err := grpcui.AllMethodsForServer(rpc)
	if err != nil {
		return nil, err
	}

	files, err := grpcui.AllFilesViaInProcess()
	if err != nil {
		return nil, err
	}

	lis := bufconn.Listen(1024 * 1024)
	g.Go(func() error {
		err := rpc.Serve(lis)
		if errors.Is(err, grpc.ErrServerStopped) {
			return nil
		}
		return err
	})

	conn, err := grpc.NewClient("passthrough:///seed-daemon-grpcui",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, err
	}
	clean.AddErrFunc(conn.Close)

	grpcUIMu.Lock()
	h := standalone.Handler(conn, "seed daemon", methods, files)
	grpcUIMu.Unlock()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		grpcUIMu.Lock()
		defer grpcUIMu.Unlock()
		h.ServeHTTP(w, r)
	}), nil
}

func loopbackOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ap, err := netip.ParseAddrPort(r.RemoteAddr)
		if err != nil {
			http.Error(w, "bad remote address", http.StatusBadRequest)
			return
		}

		ip := ap.Addr().Unmap()

		if !ip.IsLoopback() {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		switch r.Header.Get("Sec-Fetch-Site") {
		case "", "none", "same-origin":
			// Fetch Metadata is browser-provided. Missing headers are allowed so
			// non-browser local clients keep working, and "none" covers direct
			// user navigations to localhost debug URLs.
			next.ServeHTTP(w, r)
		default:
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	})
}

func authContextMiddleware(auth *daemonapi.Server) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get("Authorization")
			scheme, token, ok := strings.Cut(raw, " ")
			if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
				next.ServeHTTP(w, r)
				return
			}

			caller, err := auth.AuthenticateBearerToken(r.Context(), strings.TrimSpace(token))
			if err != nil {
				http.Error(w, "bad bearer authorization", http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r.WithContext(blob.WithAuthenticatedCaller(r.Context(), caller)))
		})
	}
}

func publicOnlyMiddleware(publicOnly bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if !publicOnly {
			return next
		}

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := blob.WithPublicOnly(r.Context())
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// openCORSMiddleware allows different host/origins.
func openCORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// We don't rely on CORS for protection. Routes that expose sensitive
		// data or actions must require authentication or their own access policy,
		// hence by default we allow very broad CORS settings on purpose.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.Header().Set("Access-Control-Allow-Methods", "*")

		isPreflight := r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""

		// We short-circuit the request when it's a preflight.
		if isPreflight {
			// Chrome's Private Network Access requires the server to ack the
			// preflight when a non-private origin targets a private/loopback
			// address.
			if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func gitVersionHandler() http.Handler {
	type gitInfo struct {
		Branch string `json:"branch,omitempty"`
		Commit string `json:"commit,omitempty"`
		Date   string `json:"date,omitempty"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var res gitInfo
		res.Branch = branch
		res.Commit = commit
		res.Date = date
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(res); err != nil {
			http.Error(w, "Failed to marshal git version: "+err.Error(), http.StatusInternalServerError)
			return
		}
	})
}

func buildInfoHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info, ok := debug.ReadBuildInfo()
		if !ok {
			http.Error(w, "doesn't support build info", http.StatusExpectationFailed)
			return
		}

		// Don't want to show information about all the dependencies.
		info.Deps = nil

		// Want to support text and json.
		wantJSON := slices.Contains(r.Header.Values("Accept"), "application/json") ||
			r.URL.Query().Get("format") == "json"

		if wantJSON {
			w.Header().Set("Content-Type", "application/json")

			enc := json.NewEncoder(w)
			enc.SetIndent("", "  ")

			if err := enc.Encode(info); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
		} else {
			w.Header().Set("Content-Type", "text/plain")
			fmt.Fprint(w, info.String())
		}
	})
}

var (
	mInFlightGauge = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "seed_http_requests_in_flight",
		Help: "Number of HTTP requests currently being served.",
	})

	mCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "seed_http_requests_total",
			Help: "Total number of HTTP requests served.",
		},
		[]string{"code", "method"},
	)

	mDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "seed_http_request_duration_seconds",
			Help:    "HTTP request latencies.",
			Buckets: []float64{.25, .5, 1, 2.5, 5, 10},
		},
		[]string{"handler", "method"},
	)
)

var ctxKeyHandlerName = ctxkey.New("daemon.HTTPHandlerName", "")

func handlerNameMiddleware(mux *http.ServeMux) func(http.Handler) http.Handler {
	return func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			name := r.URL.String()
			var pattern string
			if strings.HasPrefix(r.URL.Path, "/debug/pprof") {
				_, pattern = http.DefaultServeMux.Handler(r)
			}
			if pattern == "" {
				_, pattern = mux.Handler(r)
			}
			if pattern != "" {
				routeName := routeNameFromPattern(pattern)
				// Skip the catch-all "/" too: gRPC-Web is mounted there and
				// covers many distinct methods (e.g. /seed.documents.v3alpha.Documents/PrepareChange).
				// Overriding with "/" buckets every gRPC call under a single trace
				// row and hides per-method latency on /debug/traces.
				if routeName != "/{$}" && routeName != "/" {
					name = routeName
				}
			}

			ctx := r.Context()
			ctx = ctxKeyHandlerName.WithValue(ctx, name)
			r = r.WithContext(ctx)

			h.ServeHTTP(w, r)
		})
	}
}

func routeNameFromPattern(pattern string) string {
	if _, path, ok := strings.Cut(pattern, " "); ok && strings.HasPrefix(path, "/") {
		pattern = path
	}
	if strings.HasSuffix(pattern, "/") && pattern != "/" {
		return strings.TrimSuffix(pattern, "/")
	}
	if strings.HasSuffix(pattern, "/{$}") {
		return strings.TrimSuffix(pattern, "{$}")
	}
	if strings.HasSuffix(pattern, "/{rest...}") {
		return strings.TrimSuffix(pattern, "/{rest...}")
	}
	return pattern
}

func instrument(next http.Handler) http.Handler {
	next = eztrc.Middleware(func(r *http.Request) string {
		return handlerNameFromContext(r.Context())
	})(next)

	next = promhttp.InstrumentHandlerInFlight(mInFlightGauge, next)
	next = promhttp.InstrumentHandlerCounter(mCounter, next)
	next = promhttp.InstrumentHandlerDuration(mDuration, next, promhttp.WithLabelFromCtx("handler", handlerNameFromContext))

	return next
}

func handlerNameFromContext(ctx context.Context) string {
	v, ok := ctxKeyHandlerName.ValueOk(ctx)
	if !ok {
		panic("BUG: no handler name in context")
	}
	return v
}

// Router is a wrapper around mux that can build the navigation menu.
type Router struct {
	mux         *http.ServeMux
	middlewares []func(http.Handler) http.Handler
	nav         []string
}

type routeGroup struct {
	router      *Router
	middlewares []func(http.Handler) http.Handler
}

// ServeHTTP serves a request with the router's middleware chain.
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.withMiddlewares(r.mux).ServeHTTP(w, req)
}

// Use appends middleware to the router.
// Register all middlewares before defining handlers when possible.
func (r *Router) Use(middlewares ...func(http.Handler) http.Handler) {
	r.middlewares = append(r.middlewares, middlewares...)
}

// With returns a route group with the given middlewares.
func (r *Router) With(middlewares ...func(http.Handler) http.Handler) routeGroup {
	return routeGroup{
		router:      r,
		middlewares: middlewares,
	}
}

// Handle a route.
func (r *Router) Handle(path string, h http.Handler) {
	r.mux.Handle(path, h)
}

// HandleFunc registers a function handler for a route.
func (r *Router) HandleFunc(path string, h func(http.ResponseWriter, *http.Request)) {
	r.Handle(path, http.HandlerFunc(h))
}

// HandleNav registers a route and adds it to the navigation menu.
func (r *Router) HandleNav(path string, h http.Handler) {
	r.Handle(path, h)
	r.nav = append(r.nav, routeNameFromPattern(path))
}

func (g routeGroup) Handle(path string, h http.Handler) {
	g.router.Handle(path, g.withMiddlewares(h))
}

func (g routeGroup) HandleFunc(path string, h func(http.ResponseWriter, *http.Request)) {
	g.Handle(path, http.HandlerFunc(h))
}

func (g routeGroup) HandleNav(path string, h http.Handler) {
	g.router.HandleNav(path, g.withMiddlewares(h))
}

func (r *Router) withMiddlewares(h http.Handler) http.Handler {
	for i := len(r.middlewares) - 1; i >= 0; i-- {
		h = r.middlewares[i](h)
	}
	return h
}

func (g routeGroup) withMiddlewares(h http.Handler) http.Handler {
	for i := len(g.middlewares) - 1; i >= 0; i-- {
		h = g.middlewares[i](h)
	}
	return h
}

func (r *Router) Index(w http.ResponseWriter, _ *http.Request) {
	for _, route := range r.nav {
		fmt.Fprintf(w, `<p><a href="%s">%s</a></p>`, route, route)
	}
}

func ipfsGetHandler(fileHandler http.HandlerFunc, dagJSONHandler http.HandlerFunc) http.HandlerFunc {
	const suffix = ".dagjson"

	return func(w http.ResponseWriter, r *http.Request) {
		cs := r.PathValue("cid")
		if strings.HasSuffix(cs, suffix) {
			r.SetPathValue("cid", strings.TrimSuffix(cs, suffix))
			dagJSONHandler(w, r)
			return
		}

		fileHandler(w, r)
	}
}

func makeBlobDAGJSONHandler(bs blockstore.Blockstore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cs := r.PathValue("cid")
		if cs == "" {
			http.Error(w, "missing cid", http.StatusBadRequest)
			return
		}

		c, err := cid.Decode(cs)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		blk, err := bs.Get(r.Context(), c)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		dec, err := multicodec.LookupDecoder(c.Prefix().Codec)
		if err != nil {
			http.Error(w, "unknown decoder "+err.Error(), http.StatusBadRequest)
			return
		}

		node, err := ipld.Decode(blk.RawData(), dec)
		if err != nil {
			http.Error(w, "failed to decode IPFS block "+err.Error(), http.StatusInternalServerError)
			return
		}

		data, err := ipld.Encode(node, dagjson.Encode)
		if err != nil {
			http.Error(w, "failed to encode IPFS block "+err.Error(), http.StatusInternalServerError)
			return
		}

		var b bytes.Buffer
		if err := json.Indent(&b, data, "", "  "); err != nil {
			http.Error(w, "failed to format JSON "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = io.Copy(w, &b)
	}
}

// httpRequestTag classifies an inbound HTTP request into a small set of tags
// surfaced on /debug/network. The gRPC-Web check matches the Content-Type used
// by the improbable-eng grpc-web wrapper.
func httpRequestTag(r *http.Request) string {
	path := r.URL.Path
	switch {
	case strings.HasPrefix(path, "/debug/"):
		return "debug"
	case strings.HasPrefix(path, "/ipfs/"):
		return "gateway"
	}
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "application/grpc-web") {
		return "grpc-web"
	}
	if r.Method == http.MethodOptions && strings.HasPrefix(r.Header.Get("Access-Control-Request-Headers"), "x-grpc-web") {
		return "grpc-web"
	}
	return "other"
}
