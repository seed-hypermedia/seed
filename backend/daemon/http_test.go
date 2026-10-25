package daemon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/hmnet"
	"seed/backend/storage"
	"seed/backend/util/cleanup"
	"seed/backend/util/sqlite/sqlitex"
	"strings"
	"testing"

	"seed/backend/util/must"

	"github.com/ipfs/boxo/exchange/offline"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multihash"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
)

// TestSecurity_APIHost covers DNS rebinding through a loopback connection (#1259).
func TestSecurity_APIHost(t *testing.T) {
	t.Parallel()

	access, err := newAPIAccess(config.Base{})
	require.NoError(t, err)
	handler := access.middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, tt := range []struct {
		host  string
		local bool
	}{
		{"", false},
		{"localhost", true},
		{"LOCALHOST:58001", true},
		{"127.0.0.1", true},
		{"127.23.45.67:56001", true},
		{"[::1]", true},
		{"[0:0:0:0:0:0:0:1]:58001", true},
		{"[::ffff:127.0.0.1]:56001", true},
		{"[::ffff:7f17:2d43]", true},
		{"attacker.example:58001", false},
		{"localhost.attacker.example", false},
		{"app.localhost", false},
		{"192.168.1.2:58001", false},
		{"[::ffff:192.168.1.2]:58001", false},
		{"[2001:db8::1]", false},
		{"attacker.example@localhost", false},
		{"localhost/attacker.example", false},
		{"localhost?attacker.example", false},
		{"localhost#attacker.example", false},
		{"localhost:bad", false},
	} {
		for _, site := range []string{"", "none", "same-origin", "same-site", "cross-site"} {
			t.Run(tt.host+"/"+site, func(t *testing.T) {
				req := httptest.NewRequest(http.MethodGet, "/debug/metrics", nil)
				req.RemoteAddr = "127.0.0.1:12345"
				req.Host = tt.host
				if tt.host == "" {
					// HTTP/1.0 permits an absent Host at the HTTP parser.
					req.Proto = "HTTP/1.0"
					req.ProtoMinor = 0
				}
				req.Header.Set("Sec-Fetch-Site", site)
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, req)

				want := http.StatusForbidden
				if tt.local && (site == "" || site == "none" || site == "same-origin") {
					want = http.StatusNoContent
				}
				require.Equal(t, want, rec.Code)
			})
		}
	}
}

// TestSecurity_APIPeer preserves the peer-IP gate independently of Host.
func TestSecurity_APIPeer(t *testing.T) {
	t.Parallel()

	access, err := newAPIAccess(config.Base{})
	require.NoError(t, err)
	handler := access.middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	for _, tt := range []struct {
		remote string
		want   int
	}{
		{"127.23.45.67:12345", http.StatusNoContent},
		{"[::1]:12345", http.StatusNoContent},
		{"[::ffff:127.0.0.1]:12345", http.StatusNoContent},
		{"192.168.1.2:12345", http.StatusForbidden},
		{"[::ffff:192.168.1.2]:12345", http.StatusForbidden},
		{"invalid", http.StatusBadRequest},
	} {
		t.Run(tt.remote, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/debug/grpcui/invoke/test", nil)
			req.RemoteAddr = tt.remote
			req.Host = "localhost:58001"
			req.Header.Set("Origin", "http://localhost:58001")
			req.Header.Set("Sec-Fetch-Site", "same-origin")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			require.Equal(t, tt.want, rec.Code)
		})
	}
}

func TestSecurity_APIBrowserAdmission(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name   string
		cfg    config.Base
		peer   string
		host   string
		origin string
		ref    string
		site   string
		want   int
	}{
		{name: "local tool", want: http.StatusNoContent},
		{name: "grpcui POST", origin: "http://localhost:58001", site: "same-origin", want: http.StatusNoContent},
		{name: "navigation", site: "none", want: http.StatusNoContent},
		{name: "foreign origin without metadata", origin: "https://evil.example", want: http.StatusForbidden},
		{name: "foreign origin with same-origin metadata", origin: "https://evil.example", site: "same-origin", want: http.StatusForbidden},
		{name: "foreign same-site", origin: "http://localhost:9999", site: "same-site", want: http.StatusForbidden},
		{name: "cross-site without origin", site: "cross-site", want: http.StatusForbidden},
		{name: "unknown metadata", site: "unknown", want: http.StatusForbidden},
		{name: "trusted renderer", cfg: config.Base{APIAllowedOrigins: "http://localhost:5173"}, origin: "http://localhost:5173", site: "same-site", want: http.StatusNoContent},
		{name: "renderer media without Origin", cfg: config.Base{APIAllowedOrigins: "http://localhost:5173"}, ref: "http://localhost:5173/document", site: "same-site", want: http.StatusNoContent},
		{name: "renderer media across loopback hostnames", cfg: config.Base{APIAllowedOrigins: "http://localhost:5173"}, ref: "http://localhost:5173/", site: "cross-site", want: http.StatusNoContent},
		{name: "foreign Referer without metadata", ref: "https://evil.example/document", want: http.StatusForbidden},
		{name: "Referer origin prefix attack", cfg: config.Base{APIAllowedOrigins: "https://app.example"}, ref: "https://app.example.evil.example/", site: "cross-site", want: http.StatusForbidden},
		{name: "Referer cannot override Origin", cfg: config.Base{APIAllowedOrigins: "http://localhost:5173"}, origin: "https://evil.example", ref: "http://localhost:5173/", site: "cross-site", want: http.StatusForbidden},
		{name: "trusted remote renderer", cfg: config.Base{APIAllowedOrigins: "https://app.example"}, origin: "https://app.example", site: "cross-site", want: http.StatusNoContent},
		{name: "origin cannot admit peer", cfg: config.Base{APIAllowedOrigins: "https://app.example"}, peer: "100.64.1.3:12345", origin: "https://app.example", site: "cross-site", want: http.StatusForbidden},
		{name: "origin cannot admit rebound Host", cfg: config.Base{APIAllowedOrigins: "https://app.example"}, host: "evil.example", origin: "https://app.example", site: "same-origin", want: http.StatusForbidden},
		{name: "unconfigured remote tool", peer: "100.64.1.3:12345", want: http.StatusForbidden},
		{name: "configured remote tool", cfg: config.Base{APIAllowedPeers: "100.64.1.3"}, peer: "100.64.1.3:12345", host: "100.64.1.3:58001", want: http.StatusNoContent},
		{name: "configured remote CIDR", cfg: config.Base{APIAllowedPeers: "100.64.1.0/24", APIAllowedHosts: "seed.tail.example"}, peer: "100.64.1.3:12345", host: "seed.tail.example:58001", want: http.StatusNoContent},
		{name: "outside configured CIDR", cfg: config.Base{APIAllowedPeers: "100.64.1.0/24"}, peer: "100.64.2.3:12345", want: http.StatusForbidden},
		{name: "Host cannot admit peer", cfg: config.Base{APIAllowedHosts: "seed.tail.example"}, peer: "100.64.1.3:12345", host: "seed.tail.example", want: http.StatusForbidden},
		{name: "mapped configured peer", cfg: config.Base{APIAllowedPeers: "::ffff:100.64.1.0/120"}, peer: "[::ffff:100.64.1.3]:12345", host: "[::ffff:100.64.1.3]:58001", want: http.StatusNoContent},
		{name: "server container networking", cfg: config.Base{ServerMode: true}, peer: "172.20.0.3:12345", host: "seed-daemon:56001", origin: "https://public.example", site: "cross-site", want: http.StatusNoContent},
	} {
		t.Run(tt.name, func(t *testing.T) {
			access, err := newAPIAccess(tt.cfg)
			require.NoError(t, err)
			h := access.middleware(openCORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})))
			for _, method := range []string{http.MethodPost, http.MethodOptions} {
				req := httptest.NewRequest(method, "/debug/grpcui/invoke/test", nil)

				req.RemoteAddr = "127.0.0.1:12345"
				if tt.peer != "" {
					req.RemoteAddr = tt.peer
				}

				req.Host = "localhost:58001"
				if tt.host != "" {
					req.Host = tt.host
				}

				req.Header.Set("Origin", tt.origin)
				req.Header.Set("Referer", tt.ref)
				req.Header.Set("Sec-Fetch-Site", tt.site)
				req.Header.Set("Access-Control-Request-Method", "POST")
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, req)
				require.Equal(t, tt.want, rec.Code, method)
			}
		})
	}
}

func TestMakeBlobDAGJSONHandler_ServerMode(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestMemoryDB(t)
	idx := must.Do2(blob.OpenIndex(context.Background(), db, zap.NewNop()))
	// Offline exchange = local-only lookups, same wiring as cfg.Syncing.NoDiscovery.
	fm := hmnet.NewFileManager(zap.NewNop(), idx, offline.Exchange(idx), idx)

	// Create two blocks and store them.
	privateData := []byte("private blob content")
	publicData := []byte("public blob content")

	privateCID := makeCID(t, privateData)
	publicCID := makeCID(t, publicData)

	privateBlk, err := blocks.NewBlockWithCid(privateData, privateCID)
	require.NoError(t, err)
	publicBlk, err := blocks.NewBlockWithCid(publicData, publicCID)
	require.NoError(t, err)

	require.NoError(t, idx.Put(context.Background(), privateBlk))
	require.NoError(t, idx.Put(context.Background(), publicBlk))

	// Mark the public blob as public via blob_visibility.
	conn, release, err := db.WriteConn(context.Background())
	require.NoError(t, err)
	require.NoError(t, sqlitex.Exec(conn,
		`INSERT INTO blob_visibility (id, space) SELECT id, 0 FROM blobs WHERE multihash = ?`,
		nil, publicCID.Hash()))
	release()

	// The private blob has no blob_visibility entry, so it's not in public_blobs.

	t.Run("ServerMode=true blocks private blobs", func(t *testing.T) {
		handler := serverModeMiddleware(true)(makeBlobDAGJSONHandler(fm))

		// Private blob should return 404.
		rec := serveBlobDAGJSON(t, handler, privateCID.String())
		require.Equal(t, http.StatusNotFound, rec.Code, "private blob must be blocked when ServerMode=true")

		// Public blob should succeed (will fail at IPLD decode since raw codec, but not 404).
		rec = serveBlobDAGJSON(t, handler, publicCID.String())
		// Raw codec blocks fail at the IPLD decode step with 400, not at the blockstore level.
		// The key assertion is that it does NOT return 404 — the blob was found.
		require.NotEqual(t, http.StatusNotFound, rec.Code, "public blob must be accessible when ServerMode=true")
	})

	t.Run("ServerMode=false serves all blobs", func(t *testing.T) {
		handler := serverModeMiddleware(false)(makeBlobDAGJSONHandler(fm))

		// Both blobs should be found (not 404).
		rec := serveBlobDAGJSON(t, handler, privateCID.String())
		require.NotEqual(t, http.StatusNotFound, rec.Code, "private blob must be accessible when ServerMode=false")

		rec = serveBlobDAGJSON(t, handler, publicCID.String())
		require.NotEqual(t, http.StatusNotFound, rec.Code, "public blob must be accessible when ServerMode=false")
	})

	t.Run("nonexistent CID returns 404", func(t *testing.T) {
		handler := makeBlobDAGJSONHandler(fm)

		fakeCID := makeCID(t, []byte("does not exist"))
		rec := serveBlobDAGJSON(t, handler, fakeCID.String())
		require.Equal(t, http.StatusNotFound, rec.Code)
	})
}

func TestIPFSGetHandlerRoutesDAGJSONSuffix(t *testing.T) {
	t.Parallel()

	handler := ipfsGetHandler(
		func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		},
		func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "bafytest", r.PathValue("cid"))
			w.WriteHeader(http.StatusAccepted)
		},
	)

	req := httptest.NewRequest("GET", "/ipfs/bafytest.dagjson", nil)
	req.SetPathValue("cid", "bafytest.dagjson")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusAccepted, rec.Code)
}

func TestMakeGRPCUIHandler(t *testing.T) {
	t.Parallel()

	var clean cleanup.Stack
	var g errgroup.Group
	rpc := grpc.NewServer()
	grpc_health_v1.RegisterHealthServer(rpc, health.NewServer())
	t.Cleanup(func() {
		require.NoError(t, clean.Close())
		rpc.Stop()
		require.NoError(t, g.Wait())
	})

	handler, err := makeGRPCUIHandler(rpc, &clean, &g)
	require.NoError(t, err)
	access, err := newAPIAccess(config.Base{})
	require.NoError(t, err)
	handler = access.middleware(handler)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "http://localhost/", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "grpc.health.v1.Health")
	cookies := rec.Result().Cookies()

	rec = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "http://localhost/metadata?method=grpc.health.v1.Health.Check", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"requestType": "grpc.health.v1.HealthCheckRequest"`)

	for _, origin := range []string{"http://localhost", "https://evil.example"} {
		rec = httptest.NewRecorder()
		req = httptest.NewRequest("POST", "http://localhost/invoke/grpc.health.v1.Health.Check", strings.NewReader(`{"data":[{}]}`))
		req.RemoteAddr = "127.0.0.1:12345"
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		for _, cookie := range cookies {
			req.AddCookie(cookie)

			if cookie.Name == "_grpcui_csrf_token" {
				req.Header.Set("X-Grpcui-Csrf-Token", cookie.Value)
			}
		}

		handler.ServeHTTP(rec, req)

		if origin == "http://localhost" {
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			require.Contains(t, rec.Body.String(), `"status": "SERVING"`)
		} else {
			require.Equal(t, http.StatusForbidden, rec.Code)
		}
	}
}

// serveBlobDAGJSON calls the handler with a request that has the CID path value set.
func serveBlobDAGJSON(t *testing.T, handler http.Handler, cidStr string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/ipfs/"+cidStr+".dagjson", nil)
	req.SetPathValue("cid", cidStr)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func makeCID(t *testing.T, data []byte) cid.Cid {
	t.Helper()
	mh, err := multihash.Sum(data, multihash.SHA2_256, -1)
	require.NoError(t, err)
	return cid.NewCidV1(cid.Raw, mh)
}
