package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime/debug"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/hmnet"
	"seed/backend/logging"
	"seed/backend/util/cleanup"
	"strconv"
	"time"

	"github.com/gorilla/mux"
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
)

var (
	commit string
	branch string
	date   string
)

func makeBlobDebugHandler(bs blockstore.Blockstore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cs := mux.Vars(r)["cid"]
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

		_, _ = io.Copy(w, &b)
	}
}

// setupGRPCWebHandler sets up the gRPC-Web handler.
func setupGRPCWebHandler(r *Router, rpc *grpc.Server) {
	grpcWebHandler := grpcweb.WrapServer(rpc, grpcweb.WithOriginFunc(func(origin string) bool {
		return true
	}))

	r.r.MatcherFunc(mux.MatcherFunc(func(r *http.Request, match *mux.RouteMatch) bool {
		return grpcWebHandler.IsAcceptableGrpcCorsRequest(r) || grpcWebHandler.IsGrpcWebRequest(r)
	})).Handler(grpcWebHandler)
}

func initHTTP(
	cfg config.Base,
	port int,
	rpc *grpc.Server,
	clean *cleanup.Stack,
	g *errgroup.Group,
	blobs blockstore.Blockstore,
	ipfsHandler *hmnet.FileManager,
	p2pnet *hmnet.Node,
	extraHandlers ...func(*Router),
) (srv *http.Server, lis net.Listener, err error) {
	router := &Router{r: mux.NewRouter()}

	router.r.Use(
		handlerNameMiddleware,
		instrument,
	)

	{
		setupGRPCWebHandler(router, rpc)

		router.Handle("/ipfs/file-upload", http.HandlerFunc(ipfsHandler.UploadFile), 0)
		router.Handle("/ipfs/{cid}", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// We only want to serve public blobs on the web.
			// We set this config value in the Dockerfile that we deploy.
			if cfg.PublicOnly {
				r = r.WithContext(blob.WithPublicOnly(r.Context()))
			}
			ipfsHandler.GetFile(w, r)
		}), 0)

		router.Handle("/debug/metrics", promhttp.Handler(), RouteNav)
		router.Handle("/debug/pprof", http.DefaultServeMux, RoutePrefix|RouteNav)
		router.Handle("/debug/vars", http.DefaultServeMux, RoutePrefix|RouteNav)
		router.Handle("/debug/grpc", grpcLogsHandler(), RouteNav)
		router.Handle("/debug/buildinfo", buildInfoHandler(), RouteNav)
		router.Handle("/debug/version", gitVersionHandler(), RouteNav)
		router.Handle("/debug/cid/{cid}", corsMiddleware(makeBlobDebugHandler(blobs)), 0)
		router.Handle("/debug/traces", eztrc.Handler(), RouteNav)
		router.Handle("/debug/logs", logging.DebugHandler(), RouteNav)
		router.Handle("/debug/requests", http.DefaultServeMux, RouteNav)
		router.Handle("/debug/events", http.DefaultServeMux, RouteNav)
		router.Handle("/debug/p2p", p2pnet.DebugHandler(), RouteNav)

		router.Handle("/hm/api/config", p2pnet.HMAPIConfigHandler(), RouteNav)

		for _, handle := range extraHandlers {
			handle(router)
		}

		router.Handle("/", http.HandlerFunc(router.Index), 0)
	}

	srv = &http.Server{
		Addr:              ":" + strconv.Itoa(port),
		ReadHeaderTimeout: 5 * time.Second,
		// WriteTimeout:      10 * time.Second,
		IdleTimeout: 20 * time.Second,
		Handler:     router.r,
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

// corsMiddleware allows different host/origins.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// allow cross domain AJAX requests
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Cache-Control")
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
		if err := json.NewEncoder(w).Encode(res); err != nil {
			http.Error(w, "Failed to marshal git version: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
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

var (
	ctxKeyHandlerName = "seed/http/handlerName"
)

func handlerNameMiddleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.String()
		route := mux.CurrentRoute(r)
		if route != nil {
			rn := route.GetName()
			if rn != "/" && rn != "" {
				name = rn
			}
		}

		ctx := r.Context()
		ctx = context.WithValue(ctx, &ctxKeyHandlerName, name)
		r = r.WithContext(ctx)

		h.ServeHTTP(w, r)
	})
}

func instrument(h http.Handler) http.Handler {
	h = eztrc.Middleware(func(r *http.Request) string {
		v := r.Context().Value(&ctxKeyHandlerName)
		if v == nil {
			panic("BUG: no handler name in context")
		}
		return v.(string)
	})(h)

	h = promhttp.InstrumentHandlerInFlight(mInFlightGauge, h)
	h = promhttp.InstrumentHandlerCounter(mCounter, h)
	h = promhttp.InstrumentHandlerDuration(mDuration, h, promhttp.WithLabelFromCtx("handler", func(ctx context.Context) string {
		v := ctx.Value(&ctxKeyHandlerName)
		if v == nil {
			panic("BUG: no handler name in context")
		}
		return v.(string)
	}))

	return h
}

const (
	// RoutePrefix exposes path prefix.
	RoutePrefix = 1 << 1
	// RouteNav adds the path to a route nav.
	RouteNav = 1 << 2
)

// Router is a wrapper around mux that can build the navigation menu.
type Router struct {
	r   *mux.Router
	nav []string
}

// Handle a route.
func (r *Router) Handle(path string, h http.Handler, mode int) {
	if mode&RouteNav != 0 {
		r.r.Name(path).PathPrefix(path).Handler(h)
	} else {
		r.r.Name(path).Path(path).Handler(h)
	}

	if mode&RouteNav != 0 {
		r.nav = append(r.nav, path)
	}
}

func (r *Router) Index(w http.ResponseWriter, _ *http.Request) {
	for _, route := range r.nav {
		fmt.Fprintf(w, `<p><a href="%s">%s</a></p>`, route, route)
	}
}
