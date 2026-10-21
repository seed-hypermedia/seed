package daemon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"seed/backend/blob"
	"seed/backend/hmnet"
	"seed/backend/storage"
	"seed/backend/util/cleanup"
	"seed/backend/util/sqlite/sqlitex"
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

// TestSecurity_LoopbackOnlyHost covers DNS rebinding through a loopback connection (#1259).
func TestSecurity_LoopbackOnlyHost(t *testing.T) {
	t.Parallel()

	handler := loopbackOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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

// TestSecurity_LoopbackOnlyPeer preserves the peer-IP gate independently of Host.
func TestSecurity_LoopbackOnlyPeer(t *testing.T) {
	t.Parallel()

	handler := loopbackOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
