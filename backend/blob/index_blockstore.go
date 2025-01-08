package blob

import (
	"context"
	"seed/backend/ipfs"

	"seed/backend/util/sqlite/sqlitex"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multicodec"
)

// Put adds a block to the blockstore.
func (idx *Index) Put(ctx context.Context, blk blocks.Block) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	return sqlitex.WithTx(conn, func() error {
		codec, hash := ipfs.DecodeCID(blk.Cid())
		id, exists, err := idx.bs.putBlock(conn, 0, uint64(codec), hash, blk.RawData())
		if err != nil {
			return err
		}

		if exists || !isIndexable(multicodec.Code(codec)) {
			return nil
		}

		return idx.indexBlob(conn, id, blk.Cid(), blk.RawData())
	})
}

// PutMany adds multiple blocks to the blockstore.
func (idx *Index) PutMany(ctx context.Context, blks []blocks.Block) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	return sqlitex.WithTx(conn, func() error {
		for _, blk := range blks {
			codec, hash := ipfs.DecodeCID(blk.Cid())
			id, exists, err := idx.bs.putBlock(conn, 0, uint64(codec), hash, blk.RawData())
			if err != nil {
				return err
			}

			if exists || !isIndexable(multicodec.Code(codec)) {
				continue
			}

			if err := idx.indexBlob(conn, id, blk.Cid(), blk.RawData()); err != nil {
				return err
			}
		}

		return nil
	})
}

// DeleteBlock removes a block from the blockstore.
func (idx *Index) DeleteBlock(ctx context.Context, c cid.Cid) error {
	return idx.bs.DeleteBlock(ctx, c)
}

// Has checks if a block is in the blockstore.
func (idx *Index) Has(ctx context.Context, c cid.Cid) (bool, error) {
	return idx.bs.Has(ctx, c)
}

// Get retrieves a block from the blockstore.
func (idx *Index) Get(ctx context.Context, c cid.Cid) (blocks.Block, error) {
	return idx.bs.Get(ctx, c)
}

// GetMany retrieves multiple blocks from the blockstore.
func (idx *Index) GetMany(ctx context.Context, cc []cid.Cid) ([]blocks.Block, error) {
	return idx.bs.GetMany(ctx, cc)
}

// GetSize returns the size of a block.
func (idx *Index) GetSize(ctx context.Context, c cid.Cid) (int, error) {
	return idx.bs.GetSize(ctx, c)
}

// AllKeysChan implements the IPFS Blockstore interface.
func (idx *Index) AllKeysChan(ctx context.Context) (<-chan cid.Cid, error) {
	return idx.bs.AllKeysChan(ctx)
}

// HashOnRead implements the IPFS Blockstore interface.
func (idx *Index) HashOnRead(enabled bool) {
	panic("BUG: DO NOT USE THIS!")
}
