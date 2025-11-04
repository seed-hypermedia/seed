package blob

import (
	"context"
	"iter"

	blockstore "github.com/ipfs/boxo/blockstore"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
)

// PublicBlockstore returns a blockstore that only serves public blobs.
func (idx *Index) PublicBlockstore() blockstore.Blockstore {
	return &publicBlockstore{idx: idx}
}

type publicOnlyCtxKey struct{}

// WithPublicOnly sets the public only context value to true.
func WithPublicOnly(ctx context.Context) context.Context {
	return context.WithValue(ctx, publicOnlyCtxKey{}, true)
}

// IsPublicOnly returns true if the context indicates only public blobs should be accessed.
func IsPublicOnly(ctx context.Context) bool {
	return ctx.Value(publicOnlyCtxKey{}) != nil
}

type publicBlockstore struct {
	idx *Index
}

func (pb *publicBlockstore) Put(ctx context.Context, blk blocks.Block) error {
	ctx = WithPublicOnly(ctx)
	return pb.idx.Put(ctx, blk)
}

func (pb *publicBlockstore) PutMany(ctx context.Context, blks []blocks.Block) error {
	ctx = WithPublicOnly(ctx)
	return pb.idx.PutMany(ctx, blks)
}

func (pb *publicBlockstore) DeleteBlock(ctx context.Context, c cid.Cid) error {
	ctx = WithPublicOnly(ctx)
	return pb.idx.DeleteBlock(ctx, c)
}

func (pb *publicBlockstore) Has(ctx context.Context, c cid.Cid) (bool, error) {
	ctx = WithPublicOnly(ctx)
	return pb.idx.Has(ctx, c)
}

func (pb *publicBlockstore) Get(ctx context.Context, c cid.Cid) (blocks.Block, error) {
	ctx = WithPublicOnly(ctx)
	return pb.idx.Get(ctx, c)
}

func (pb *publicBlockstore) GetMany(ctx context.Context, cc []cid.Cid) ([]blocks.Block, error) {
	ctx = WithPublicOnly(ctx)
	return pb.idx.bs.GetMany(ctx, cc)
}

func (pb *publicBlockstore) GetSize(ctx context.Context, c cid.Cid) (int, error) {
	ctx = WithPublicOnly(ctx)
	return pb.idx.bs.GetSize(ctx, c)
}

func (pb *publicBlockstore) IterMany(ctx context.Context, cc []cid.Cid) (iter.Seq[blocks.Block], func() error) {
	ctx = WithPublicOnly(ctx)
	return pb.idx.bs.IterMany(ctx, cc)
}

func (pb *publicBlockstore) AllKeysChan(ctx context.Context) (<-chan cid.Cid, error) {
	ctx = WithPublicOnly(ctx)
	return pb.idx.AllKeysChan(ctx)
}
