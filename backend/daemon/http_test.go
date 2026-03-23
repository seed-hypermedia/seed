package daemon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/storage"
	"seed/backend/util/sqlite/sqlitex"
	"testing"

	"seed/backend/util/must"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multihash"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/gorilla/mux"
)

func TestMakeBlobDebugHandler_PublicOnly(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestMemoryDB(t)
	idx := must.Do2(blob.OpenIndex(context.Background(), db, zap.NewNop()))

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
	conn, release, err := db.Conn(context.Background())
	require.NoError(t, err)
	require.NoError(t, sqlitex.Exec(conn,
		`INSERT INTO blob_visibility (id, space) SELECT id, 0 FROM blobs WHERE multihash = ?`,
		nil, publicCID.Hash()))
	release()

	// The private blob has no blob_visibility entry, so it's not in public_blobs.

	t.Run("PublicOnly=true blocks private blobs", func(t *testing.T) {
		handler := makeBlobDebugHandler(config.Base{PublicOnly: true}, idx)

		// Private blob should return 404.
		rec := serveBlobDebug(t, handler, privateCID.String())
		require.Equal(t, http.StatusNotFound, rec.Code, "private blob must be blocked when PublicOnly=true")

		// Public blob should succeed (will fail at IPLD decode since raw codec, but not 404).
		rec = serveBlobDebug(t, handler, publicCID.String())
		// Raw codec blocks fail at the IPLD decode step with 400, not at the blockstore level.
		// The key assertion is that it does NOT return 404 — the blob was found.
		require.NotEqual(t, http.StatusNotFound, rec.Code, "public blob must be accessible when PublicOnly=true")
	})

	t.Run("PublicOnly=false serves all blobs", func(t *testing.T) {
		handler := makeBlobDebugHandler(config.Base{PublicOnly: false}, idx)

		// Both blobs should be found (not 404).
		rec := serveBlobDebug(t, handler, privateCID.String())
		require.NotEqual(t, http.StatusNotFound, rec.Code, "private blob must be accessible when PublicOnly=false")

		rec = serveBlobDebug(t, handler, publicCID.String())
		require.NotEqual(t, http.StatusNotFound, rec.Code, "public blob must be accessible when PublicOnly=false")
	})

	t.Run("nonexistent CID returns 404", func(t *testing.T) {
		handler := makeBlobDebugHandler(config.Base{PublicOnly: false}, idx)

		fakeCID := makeCID(t, []byte("does not exist"))
		rec := serveBlobDebug(t, handler, fakeCID.String())
		require.Equal(t, http.StatusNotFound, rec.Code)
	})
}

// serveBlobDebug calls the handler with a mux-compatible request that has the CID variable set.
func serveBlobDebug(t *testing.T, handler http.HandlerFunc, cidStr string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/debug/cid/"+cidStr, nil)
	// Set gorilla/mux vars so mux.Vars(r) returns the CID.
	req = mux.SetURLVars(req, map[string]string{"cid": cidStr})
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
