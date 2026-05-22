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

	"github.com/ipfs/boxo/exchange"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestInboundReconcileLimiterDefaultsToFixedCap pins the auto-default
// to the conservative fixed cap chosen to prevent OOM under recursive
// account-root discovery (each call can transiently allocate hundreds
// of MB in loadRBSRStore; observed 2026-05-22). The previous
// auto-default of 2×GOMAXPROCS let six+ concurrent calls run on a
// 4-core host, peaking past the cgroup cap.
func TestInboundReconcileLimiterDefaultsToFixedCap(t *testing.T) {
	old := runtime.GOMAXPROCS(2)
	defer runtime.GOMAXPROCS(old)

	l := newInboundReconcileLimiter(0, time.Second)
	require.NotNil(t, l)
	require.Equal(t, 6, l.limit, "auto-default should be the fixed conservative cap, independent of GOMAXPROCS")
}

// TestInboundReconcileLimiterFixedCapIgnoresLowGOMAXPROCS — even on
// single-core hosts the limit stays at the fixed cap: the constraint
// is memory, not CPU.
func TestInboundReconcileLimiterFixedCapIgnoresLowGOMAXPROCS(t *testing.T) {
	old := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(old)

	l := newInboundReconcileLimiter(0, time.Second)
	require.NotNil(t, l)
	require.Equal(t, 6, l.limit)
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
