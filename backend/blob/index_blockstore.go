package blob

import (
	"context"
	"seed/backend/ipfs"
	"slices"

	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/boxo/blockservice"
	"github.com/ipfs/boxo/exchange/offline"
	"github.com/ipfs/boxo/ipld/merkledag"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	format "github.com/ipfs/go-ipld-format"
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

		return indexBlob(unreadsTrackingEnabled(ctx), conn, id, blk.Cid(), blk.RawData(), idx.bs, idx.log)
	})
}

// PutMany adds multiple blocks to the blockstore.
// Blocks are processed in batches to avoid holding the SQLite write lock
// for too long, which would block other writers (e.g. document publish).
func (idx *Index) PutMany(ctx context.Context, blks []blocks.Block) error {
	const batchSize = 100

	trackUnreads := unreadsTrackingEnabled(ctx)

	for batch := range slices.Chunk(blks, batchSize) {
		conn, release, err := idx.db.Conn(ctx)
		if err != nil {
			return err
		}

		err = sqlitex.WithTx(conn, func() error {
			for _, blk := range batch {
				codec, hash := ipfs.DecodeCID(blk.Cid())
				id, exists, err := idx.bs.putBlock(conn, 0, uint64(codec), hash, blk.RawData())
				if err != nil {
					return err
				}

				if exists || !isIndexable(multicodec.Code(codec)) {
					continue
				}

				if err := indexBlob(trackUnreads, conn, id, blk.Cid(), blk.RawData(), idx.bs, idx.log); err != nil {
					return err
				}
			}

			return nil
		})
		release()
		if err != nil {
			return err
		}
	}

	return nil
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

// Decompress decodes a compress blob content using the same codec as the underlying blockstore.
//
// TODO(burdiyan): this should probably not be exposed, but it is right now for convenience.
func (idx *Index) Decompress(in, out []byte) ([]byte, error) {
	return idx.bs.decoder.DecodeAll(in, out)
}

// DAGService creates a DAGService instance from the underlying blockstore.
func (idx *Index) DAGService() format.DAGService {
	bsvc := blockservice.New(idx, offline.Exchange(idx))
	return merkledag.NewDAGService(bsvc)
}
