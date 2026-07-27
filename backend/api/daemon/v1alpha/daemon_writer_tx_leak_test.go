package daemon

import (
	"context"
	"errors"
	"testing"

	"seed/backend/blob"
	"seed/backend/core/coretest"
	taskmanager "seed/backend/daemon/taskmanager"
	daemon "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/storage"
	"seed/backend/storage/vault"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multicodec"
	"github.com/multiformats/go-multihash"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestStoreBlobsAckMustBeDurable reproduces the 2026-07-24 prod incident shape
// at the gRPC surface: StoreBlobs acknowledged 3 blobs (returned their CIDs)
// while the pool's single write connection was carrying a transaction leaked by
// an earlier interrupted request; the blobs were invisible to readers and were
// destroyed ~2.5 hours later when the leaked transaction rolled back — no
// daemon restart involved.
//
// The trigger uses only public API: a WithTx whose request ctx is canceled
// mid-transaction. Before the fix, WithTx's internal ROLLBACK failed on the
// tripped interrupt and Pool.Put recycled the connection without noticing the
// open transaction; every later StoreBlobs then nested as a silent savepoint
// inside it. The fix (WithTx force-rollback + Pool.Put repair) must keep
// StoreBlobs' acknowledgment truthful. See the companion tests in
// util/sqlite/sqlitex/tx_leak_test.go for the pool-level mechanics.
func TestStoreBlobsAckMustBeDurable(t *testing.T) {
	u := coretest.NewTester("alice")
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	dataDir := t.TempDir()
	secretStore, err := vault.NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store("local", "", keyMaterial))

	ks, err := vault.New(dataDir, secretStore)
	require.NoError(t, err)

	store, err := storage.Open(dataDir, u.Device.Libp2pKey(), ks, "debug")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })
	tMgr := taskmanager.NewTaskManager()
	idx, err := blob.OpenIndex(t.Context(), store.DB(), zap.NewNop())
	require.NoError(t, err)

	srv := NewServer(store, &mockedP2PNode{}, idx, tMgr, zap.NewNop())

	// The prod trigger: an earlier request is canceled mid-transaction, so
	// WithTx's plain ROLLBACK is interrupted. Before the fix this leaked the
	// open transaction into the pool's write connection.
	poisonCtx, cancel := context.WithCancel(context.Background())
	conn, release, err := store.DB().WriteConn(poisonCtx)
	require.NoError(t, err)
	err = sqlitex.WithTx(conn, func() error {
		if err := sqlitex.Exec(conn, "CREATE TABLE IF NOT EXISTS leak_marker (x int);", nil); err != nil {
			return err
		}
		cancel()
		return errors.New("simulated canceled request")
	})
	require.Error(t, err)
	release()

	// A client publishes a blob. Raw codec keeps the blob out of the indexers
	// so the test isolates storage durability from indexing semantics.
	data := []byte("daemon writer tx leak probe")
	mh, err := multihash.Sum(data, multihash.SHA2_256, -1)
	require.NoError(t, err)
	c := cid.NewCidV1(uint64(multicodec.Raw), mh)

	resp, err := srv.StoreBlobs(t.Context(), &daemon.StoreBlobsRequest{
		Blobs: []*daemon.Blob{{Cid: c.String(), Data: data}},
	})
	require.NoError(t, err, "StoreBlobs acknowledged the blob")
	require.Equal(t, []string{c.String()}, resp.Cids)

	// The acknowledgment must mean the blob is actually there: readable through
	// the index (which uses a read connection). Today it is trapped inside the
	// leaked transaction — exactly how prod acknowledged document blobs that a
	// Resource read immediately reported as not-found.
	ok, err := idx.Has(t.Context(), c)
	require.NoError(t, err)
	require.True(t, ok,
		"blob acknowledged by StoreBlobs is not readable: it is trapped in a transaction leaked into the connection pool and will be destroyed when that transaction rolls back")
}
