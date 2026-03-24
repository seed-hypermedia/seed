package syncing

import (
	"context"
	"testing"

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
