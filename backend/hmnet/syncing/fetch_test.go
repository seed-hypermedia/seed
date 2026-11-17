package syncing

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/storage"

	"github.com/ipfs/boxo/exchange"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/grpc"
)

func TestSyncWithPeerContinuesFetch(t *testing.T) {
	testPeerFetch(t, "progress", 3, 3, []int{3, 2, 1})
}

func TestSyncWithPeerBoundsWantlists(t *testing.T) {
	testPeerFetch(t, "capped", 1025, 1025, []int{512, 512, 1})
}

func TestSyncWithPeerFetchStops(t *testing.T) {
	for _, tt := range []struct {
		mode       string
		count      int
		downloaded int
		requests   []int
	}{
		{mode: "stall", count: 3, requests: []int{3}},
		{mode: "progress_then_stall", count: 3, downloaded: 1, requests: []int{3, 2}},
		{mode: "cancel_parent", count: 3, downloaded: 1, requests: []int{3}},
		{mode: "closed", count: 3, downloaded: 1, requests: []int{3}},
		{mode: "error", count: 3, requests: []int{3}},
		{mode: "empty"},
	} {
		t.Run(tt.mode, func(t *testing.T) {
			testPeerFetch(t, tt.mode, tt.count, tt.downloaded, tt.requests)
		})
	}
}

func testPeerFetch(t *testing.T, mode string, count, downloaded int, requestSizes []int) {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	db := storage.MakeTestDB(t)
	idx, err := blob.OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)
	h, err := libp2p.New(libp2p.NoListenAddrs)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, h.Close()) })

	remote := rbsr.NewSliceStore()
	fetcher := &slicedFetcher{blocks: make(map[cid.Cid]blocks.Block), mode: mode, cancelParent: cancel}
	for i := range count {
		data := []byte(fmt.Sprintf("fetch slice block %d", i))
		id, err := (cid.Prefix{Version: 1, Codec: cid.Raw, MhType: 0x12, MhLength: -1}).Sum(data)
		require.NoError(t, err)
		blk, err := blocks.NewBlockWithCid(data, id)
		require.NoError(t, err)
		fetcher.blocks[blk.Cid()] = blk
		require.NoError(t, remote.Insert(int64(i+1), blk.Cid().Bytes()))
	}

	require.NoError(t, remote.Seal())
	session, err := rbsr.NewSession(remote, rbsrMsgSizeBytes)
	require.NoError(t, err)
	store := newAuthorizedStore()
	require.NoError(t, store.Seal())
	svc := &Service{
		db:    db,
		cfg:   config.Syncing{TimeoutPerPeer: 100 * time.Millisecond},
		host:  h,
		index: &fetchTestIndex{Index: idx},
		log:   zap.NewNop(),
		rbsrClient: func(context.Context, peer.ID, ...multiaddr.Multiaddr) (p2p.SyncingClient, error) {
			return &fetchTestClient{session: session}, nil
		},
	}
	prog := &Progress{}
	var claimed sync.Map

	pf := startPersistFeeder(t.Context(), idx, zap.NewNop())
	t.Cleanup(func() { close(pf.ch) })
	require.NoError(t, svc.syncWithPeer(ctx, peer.ID("remote"), map[string]entityScope{"hm://test": {}}, store, prog, nil, nil, fetcher, &claimed, pf))
	require.EqualValues(t, downloaded, prog.BlobsDownloaded.Load())
	require.EqualValues(t, count-downloaded, prog.BlobsFailed.Load())
	require.Equal(t, len(requestSizes), len(fetcher.requests))
	for i, size := range requestSizes {
		require.Len(t, fetcher.requests[i], size)

		if i > 0 {
			require.NotContains(t, fetcher.requests[i], fetcher.requests[i-1][0])
		}
	}

	var persisted int

	for id := range fetcher.blocks {
		has, err := idx.Has(t.Context(), id)
		require.NoError(t, err)

		if has {
			persisted++
		}
	}

	require.Equal(t, downloaded, persisted)
	svc.inflight.Range(func(key, _ any) bool {
		t.Errorf("inflight claim %v was not released", key)
		return true
	})
}

type fetchTestIndex struct{ *blob.Index }

func (*fetchTestIndex) GetAuthorizedSpacesForPeer(context.Context, peer.ID, []blob.IRI) ([]core.Principal, error) {
	return nil, nil
}

type fetchTestClient struct {
	p2p.SyncingClient
	session *rbsr.Session
}

func (c *fetchTestClient) ReconcileBlobs(_ context.Context, in *p2p.ReconcileBlobsRequest, _ ...grpc.CallOption) (*p2p.ReconcileBlobsResponse, error) {
	ranges, err := c.session.Reconcile(in.Ranges)
	return &p2p.ReconcileBlobsResponse{Ranges: ranges}, err
}

type slicedFetcher struct {
	exchange.Fetcher
	blocks       map[cid.Cid]blocks.Block
	requests     [][]cid.Cid
	mode         string
	cancelParent context.CancelFunc
}

func (f *slicedFetcher) GetBlocks(ctx context.Context, wants []cid.Cid) (<-chan blocks.Block, error) {
	f.requests = append(f.requests, append([]cid.Cid(nil), wants...))
	if f.mode == "error" {
		return nil, fmt.Errorf("fetch failed")
	}

	stall := f.mode == "stall" || (f.mode == "progress_then_stall" && len(f.requests) > 1)
	ch := make(chan blocks.Block)
	go func() {
		defer close(ch)

		if f.mode == "capped" {
			for _, id := range wants[:min(len(wants), 1024)] {
				select {
				case ch <- f.blocks[id]:
				case <-ctx.Done():
					return
				}
			}

			if len(wants) > 1024 {
				<-ctx.Done()
			}

			return
		}

		if stall {
			<-ctx.Done()
			return
		}

		select {
		case ch <- f.blocks[wants[0]]:
		case <-ctx.Done():
			return
		}

		if f.mode == "cancel_parent" {
			f.cancelParent()
		}

		if len(wants) > 1 && f.mode != "closed" {
			<-ctx.Done()
		}
	}()
	return ch, nil
}
