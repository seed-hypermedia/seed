package syncing

import (
	"context"
	"runtime"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/storage"
	"seed/backend/testutil"
	"seed/backend/util/colx"

	"github.com/ipfs/boxo/exchange"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestInboundReconcileLimiterAutoScalesWithGOMAXPROCS(t *testing.T) {
	old := runtime.GOMAXPROCS(2)
	defer runtime.GOMAXPROCS(old)

	l := newInboundReconcileLimiter(0, time.Second)
	require.NotNil(t, l)
	require.Equal(t, 4, l.limit)
}

func TestInboundReconcileLimiterHasMinimumAutoLimit(t *testing.T) {
	old := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(old)

	l := newInboundReconcileLimiter(0, time.Second)
	require.NotNil(t, l)
	require.Equal(t, 2, l.limit)
}

func TestInboundReconcileLimiterDefaultsToThreeSecondWait(t *testing.T) {
	l := newInboundReconcileLimiter(1, 0)
	require.NotNil(t, l)
	require.Equal(t, 3*time.Second, l.wait)
}

func TestInboundReconcileLimiterUnlimited(t *testing.T) {
	require.Nil(t, newInboundReconcileLimiter(-1, time.Second))
}

func TestInboundReconcileLimiterRejectsAfterWait(t *testing.T) {
	l := &inboundReconcileLimiter{
		sem:   make(chan struct{}, 1),
		wait:  0,
		limit: 1,
	}

	release, err := l.acquire(t.Context())
	require.NoError(t, err)
	defer release()

	_, err = l.acquire(t.Context())
	require.Error(t, err)

	stat, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.ResourceExhausted, stat.Code())
}

func TestInboundReconcileLimiterReleaseFreesSlot(t *testing.T) {
	l := &inboundReconcileLimiter{
		sem:   make(chan struct{}, 1),
		wait:  time.Second,
		limit: 1,
	}

	release, err := l.acquire(t.Context())
	require.NoError(t, err)
	release()

	release, err = l.acquire(t.Context())
	require.NoError(t, err)
	release()
}

func TestAnnounceBlobsUnavailableDuringReindex(t *testing.T) {
	db := storage.MakeTestDB(t)
	idx := &fakeServerIndex{reindexInfo: blob.ReindexInfo{State: blob.ReindexStateInProgress}}
	srv := &Server{
		db:      db,
		index:   idx,
		bitswap: fakeBitswap{},
		log:     zap.NewNop(),
	}
	stream := testutil.NewMockedGRPCServerStream[*p2p.AnnounceBlobsProgress](t.Context())
	blk := blocks.NewBlock([]byte("hello"))

	err := srv.AnnounceBlobs(&p2p.AnnounceBlobsRequest{Cids: []string{blk.Cid().String()}}, stream)
	require.Error(t, err)

	stat, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.Unavailable, stat.Code())
	require.Equal(t, 0, idx.putManyCalls)
}

type fakeServerIndex struct {
	reindexInfo  blob.ReindexInfo
	putManyCalls int
}

func (f *fakeServerIndex) PutMany(context.Context, []blocks.Block) error {
	f.putManyCalls++
	return nil
}

func (f *fakeServerIndex) GetAuthorizedSpacesForPeer(context.Context, peer.ID, []blob.IRI) ([]core.Principal, error) {
	return nil, nil
}

func (f *fakeServerIndex) ReindexInfo() blob.ReindexInfo {
	return f.reindexInfo
}

type fakeBitswap struct{}

func (fakeBitswap) NewSession(context.Context) exchange.Fetcher {
	panic("unexpected bitswap session during reindex rejection test")
}

func (fakeBitswap) FindProvidersAsync(context.Context, cid.Cid, int) <-chan peer.AddrInfo {
	panic("unexpected provider lookup during reindex rejection test")
}

// TestServer_WarmScopeServeNeedsNoWriter proves the steady-state serve path is
// writer-free: with the pool's only write connection held hostage, a serve of
// an already-materialized scope must still complete (phases 1 and 3 run on
// read connections; phase 2 is skipped for warm scopes).
func TestServer_WarmScopeServeNeedsNoWriter(t *testing.T) {
	t.Parallel()
	db, base := oracleFixture(t)
	dkey := DiscoveryKey{IRI: blob.IRI(base), Recursive: true}
	materializeFixtureScope(t, db, dkey)

	srv := &Server{db: db, log: zap.NewNop()}

	// Hold the writer for the duration of the serve.
	_, releaseWriter, err := db.WriteConn(context.Background())
	require.NoError(t, err)
	defer releaseWriter()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dkeys := make(colx.HashSet[DiscoveryKey], 1)
	dkeys.Put(dkey)
	store, err := srv.loadStoreFromIndex(ctx, dkeys, nil)
	require.NoError(t, err, "warm-scope serve must not need the writer connection")
	require.NotNil(t, store)
}
