package daemon

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"seed/backend/blob"
	"seed/backend/core"
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

func TestMakeBlobDAGJSONHandler_PublicOnly(t *testing.T) {
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

	t.Run("PublicOnly=true blocks private blobs", func(t *testing.T) {
		handler := publicOnlyMiddleware(true)(makeBlobDAGJSONHandler(fm))

		// Private blob should return 404.
		rec := serveBlobDAGJSON(t, handler, privateCID.String())
		require.Equal(t, http.StatusNotFound, rec.Code, "private blob must be blocked when PublicOnly=true")

		// Public blob should succeed (will fail at IPLD decode since raw codec, but not 404).
		rec = serveBlobDAGJSON(t, handler, publicCID.String())
		// Raw codec blocks fail at the IPLD decode step with 400, not at the blockstore level.
		// The key assertion is that it does NOT return 404 — the blob was found.
		require.NotEqual(t, http.StatusNotFound, rec.Code, "public blob must be accessible when PublicOnly=true")
	})

	t.Run("PublicOnly=false serves all blobs", func(t *testing.T) {
		handler := publicOnlyMiddleware(false)(makeBlobDAGJSONHandler(fm))

		// Both blobs should be found (not 404).
		rec := serveBlobDAGJSON(t, handler, privateCID.String())
		require.NotEqual(t, http.StatusNotFound, rec.Code, "private blob must be accessible when PublicOnly=false")

		rec = serveBlobDAGJSON(t, handler, publicCID.String())
		require.NotEqual(t, http.StatusNotFound, rec.Code, "public blob must be accessible when PublicOnly=false")
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

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "grpc.health.v1.Health")

	rec = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/metadata?method=grpc.health.v1.Health.Check", nil)
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"requestType": "grpc.health.v1.HealthCheckRequest"`)
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

func TestHTTPBrowserGate(t *testing.T) {
	allowed := appOriginAllowlist("")
	const secret = "launch-secret"
	tests := []struct {
		name, method, path, origin, site, secret, bearer string
		status                                           int
	}{
		{name: "CLI", status: 200},
		{name: "navigation", site: "none", status: 200},
		{name: "same origin", site: "same-origin", status: 200},
		{name: "cross site", site: "cross-site", status: 403},
		{name: "same site", site: "same-site", status: 403},
		{name: "foreign origin", origin: "https://example.com", status: 403},
		{name: "null origin", origin: "null", status: 403},
		{name: "origin overrides metadata", origin: "https://example.com", site: "same-origin", status: 403},
		{name: "allowed origin still needs secret for same site", origin: "http://localhost:17654", site: "same-site", status: 403},
		{name: "desktop", origin: "http://localhost:17654", site: "cross-site", secret: secret, status: 200},
		{name: "bad secret", site: "cross-site", secret: "wrong", status: 403},
		{name: "bearer", origin: "https://example.com", bearer: "valid", status: 200},
		{name: "bad bearer", origin: "https://example.com", bearer: "invalid", status: 403},
		{name: "public file", method: "GET", path: "/ipfs/bafytest", origin: "https://example.com", status: 200},
		{name: "public dagjson", method: "GET", path: "/ipfs/bafytest.dagjson", site: "cross-site", status: 200},
		{name: "public config", method: "GET", path: "/hm/api/config", origin: "https://example.com", status: 200},
		{name: "public version", method: "GET", path: "/debug/version", site: "cross-site", status: 200},
		{name: "upload", path: "/ipfs/file-upload", site: "cross-site", status: 403},
		{name: "put blob", path: "/ipfs/bafytest", site: "cross-site", status: 403},
		{name: "vault", path: "/vault-connect", site: "cross-site", status: 403},
		{name: "config post", path: "/hm/api/config", site: "cross-site", status: 403},
		{name: "ipfs prefix is not public", method: "GET", path: "/ipfs/bafytest/extra", site: "cross-site", status: 403},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authenticate := func(_ context.Context, token string) (core.Principal, error) {
				if token != "valid" {
					return nil, errors.New("invalid token")
				}
				return core.Principal("verified"), nil
			}
			handler := browserGateMiddleware(secret, allowed, authenticate)(appCORSMiddleware(allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tt.bearer == "valid" {
					_, ok := blob.GetAuthenticatedCaller(r.Context())
					require.True(t, ok)
				}
				w.WriteHeader(http.StatusOK)
			})))
			method, path := tt.method, tt.path
			if method == "" {
				method = "POST"
			}
			if path == "" {
				path = "/com.seed.daemon.v1alpha.Daemon/ListKeys"
			}
			req := httptest.NewRequest(method, path, nil)
			req.Header.Set("Origin", tt.origin)
			req.Header.Set("Sec-Fetch-Site", tt.site)
			req.Header.Set("X-Seed-App-Secret", tt.secret)
			if tt.bearer != "" {
				req.Header.Set("Authorization", "Bearer "+tt.bearer)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			require.Equal(t, tt.status, rec.Code)
			if tt.status == 403 || !allowed(tt.origin) {
				require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))
			}
		})
	}
}

func TestHTTPCORS(t *testing.T) {
	allowed := appOriginAllowlist("http://localhost:5173")
	handler := browserGateMiddleware("secret", allowed, nil)(appCORSMiddleware(allowed)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })))
	for _, origin := range []string{"http://localhost:17654", "http://localhost:17664", "http://localhost:5173", "http://localhost:17665", "http://localhost:17654.evil.example", "https://example.com", "null"} {
		t.Run(origin, func(t *testing.T) {
			req := httptest.NewRequest("OPTIONS", "/ipfs/file-upload", nil)
			req.Header.Set("Origin", origin)
			req.Header.Set("Sec-Fetch-Site", "cross-site")
			req.Header.Set("Access-Control-Request-Method", "POST")
			req.Header.Set("Access-Control-Request-Headers", "x-seed-app-secret,content-type")
			req.Header.Set("Access-Control-Request-Private-Network", "true")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if allowed(origin) {
				require.Equal(t, 204, rec.Code)
				require.Equal(t, origin, rec.Header().Get("Access-Control-Allow-Origin"))
				require.Equal(t, "true", rec.Header().Get("Access-Control-Allow-Private-Network"))
				require.Contains(t, rec.Header().Get("Access-Control-Allow-Headers"), "X-Seed-App-Secret")
				require.Contains(t, rec.Header().Values("Vary"), "Origin")
			} else {
				require.Equal(t, 403, rec.Code)
				for key := range rec.Header() {
					require.False(t, strings.HasPrefix(key, "Access-Control-Allow-"), key)
				}
			}
		})
	}
	require.False(t, appOriginAllowlist("")("http://localhost:5173"), "Vite is trusted only when explicitly configured")
}

func TestHTTPAppSecret(t *testing.T) {
	t.Setenv("SEED_APP_SECRET", "")
	first, err := appSecretFromEnv()
	require.NoError(t, err)
	require.Len(t, first, 64)
	second, err := appSecretFromEnv()
	require.NoError(t, err)
	require.NotEqual(t, first, second)
	t.Setenv("SEED_APP_SECRET", first)
	supplied, err := appSecretFromEnv()
	require.NoError(t, err)
	require.Equal(t, first, supplied)
	t.Setenv("SEED_APP_SECRET", "too-short")
	_, err = appSecretFromEnv()
	require.Error(t, err)
}

func TestHTTPListenAddress(t *testing.T) {
	for _, all := range []bool{false, true} {
		cfg := makeTestConfig(t)
		cfg.HTTP.ListenAll = all
		cfg.PublicOnly = true
		app := makeTestApp(t, "alice", cfg, false)
		ip := app.HTTPListener.Addr().(*net.TCPAddr).IP
		if all {
			require.True(t, ip.IsUnspecified())
		} else {
			require.Equal(t, "127.0.0.1", ip.String())
		}
	}
}

// TestHTTPBrowserServer runs the real daemon for the Electron regression, with
// ephemeral ports and storage. It is opt-in and exits when the harness closes stdin.
func TestHTTPBrowserServer(t *testing.T) {
	if os.Getenv("SEED_HTTP_BROWSER_TEST_SERVER") != "1" {
		t.Skip("Electron harness only")
	}
	cfg := makeTestConfig(t)
	cfg.Syncing.NoDiscovery = true
	app := makeTestApp(t, "bob", cfg, false)
	data := []byte("public browser regression content")
	c := makeCID(t, data)
	block, err := blocks.NewBlockWithCid(data, c)
	require.NoError(t, err)
	require.NoError(t, app.Index.Put(t.Context(), block))
	conn, release, err := app.Storage.DB().WriteConn(t.Context())
	require.NoError(t, err)
	err = sqlitex.Exec(conn, `INSERT INTO blob_visibility (id, space) SELECT id, 0 FROM blobs WHERE multihash = ?`, nil, c.Hash())
	release()
	require.NoError(t, err)
	fmt.Printf("SEED_BROWSER_SERVER %s %s\n", app.HTTPListener.Addr().String(), c.String())
	_, err = io.Copy(io.Discard, os.Stdin)
	require.NoError(t, err)
}

func TestHTTPGateRoutes(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	t.Setenv("SEED_APP_SECRET", secret)
	cfg := makeTestConfig(t)
	cfg.PublicOnly = true
	app := makeTestApp(t, "carol", cfg, false)
	for _, tt := range []struct {
		name, origin, site, secret string
		status                     int
	}{
		{name: "browser denied", origin: "https://example.com", site: "cross-site", status: 403},
		{name: "app denied without secret", origin: "http://localhost:17654", site: "cross-site", status: 403},
		{name: "app authorized", origin: "http://localhost:17654", site: "cross-site", secret: secret, status: 200},
		{name: "non-browser", status: 200},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/com.seed.daemon.v1alpha.Daemon/GetInfo", strings.NewReader("\x00\x00\x00\x00\x00"))
			req.Header.Set("Content-Type", "application/grpc-web+proto")
			req.Header.Set("X-Grpc-Web", "1")
			req.Header.Set("Origin", tt.origin)
			req.Header.Set("Sec-Fetch-Site", tt.site)
			req.Header.Set("X-Seed-App-Secret", tt.secret)
			rec := httptest.NewRecorder()
			app.HTTPServer.Handler.ServeHTTP(rec, req)
			require.Equal(t, tt.status, rec.Code)
			if tt.status == 403 {
				require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))
			}
			if tt.secret != "" {
				require.Equal(t, tt.origin, rec.Header().Get("Access-Control-Allow-Origin"))
			}
		})
	}
}
