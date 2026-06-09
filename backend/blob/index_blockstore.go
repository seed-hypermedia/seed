package blob

import (
	"context"
	"seed/backend/ipfs"
	"seed/backend/util/sqlite"
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
	conn, release, err := idx.db.WriteConn(ctx)
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

		// Single-blob path: a fresh per-call cache (no cross-blob reuse to exploit).
		if err := indexBlob(unreadsTrackingEnabled(ctx), false, conn, id, blk.Cid(), blk.RawData(), idx.bs, idx.log, newWriterValidityCache()); err != nil {
			return err
		}

		return idx.runIndexedHook(conn, []int64{id})
	})
}

// PutMany adds multiple blocks to the blockstore.
// Blocks are processed in batches to avoid holding the SQLite write lock
// for too long, which would block other writers (e.g. document publish).
func (idx *Index) PutMany(ctx context.Context, blks []blocks.Block) error {
	// Chunk size caps how long a single write transaction holds the RESERVED
	// SQLite lock, and amortizes the per-tx overhead (BEGIN/COMMIT, WriteConn
	// acquire, and the coalesced visibility-propagation pass) across more blobs.
	// It was 10 when bulk sync ran many concurrent writers AND indexBlob cost
	// ~20-30ms/blob (pre cap-check + writer-cache optimizations), so 100/tx held
	// the lock for seconds and triggered SQLITE_BUSY everywhere. Now sync persists
	// through a single daemon-wide feeder (the only heavy writer) and indexBlob is
	// ~1.5ms/blob, so 100/tx holds the lock ~150ms — fewer commits, far less
	// per-tx overhead, and no contention to starve. Other PutMany callers (publish,
	// device-link, push) pass only a handful of blobs, so they're unaffected.
	const batchSize = 100

	trackUnreads := unreadsTrackingEnabled(ctx)

	for batch := range slices.Chunk(blks, batchSize) {
		conn, release, err := idx.db.WriteConn(ctx)
		if err != nil {
			return err
		}

		// One writer-validity cache per batch transaction: shared across this
		// batch's blobs and the reindex cascade they trigger, so a late capability
		// that unstashes many same-writer Refs runs the costly transitive query
		// once instead of per blob. Safe because the batch tx is single-threaded
		// over a consistent snapshot. See writerValidityCache.
		wc := newWriterValidityCache()
		err = sqlitex.WithTx(conn, func() error {
			// Track every blob we actually indexed in this batch so we can run
			// one coalesced visibility propagation pass at the end instead of
			// N separate recursive CTE walks (one per blob).
			indexed := make([]int64, 0, len(batch))
			for _, blk := range batch {
				codec, hash := ipfs.DecodeCID(blk.Cid())
				id, exists, err := idx.bs.putBlock(conn, 0, uint64(codec), hash, blk.RawData())
				if err != nil {
					return err
				}

				if exists || !isIndexable(multicodec.Code(codec)) {
					continue
				}

				if err := indexBlob(trackUnreads, true, conn, id, blk.Cid(), blk.RawData(), idx.bs, idx.log, wc); err != nil {
					return err
				}
				indexed = append(indexed, id)
			}

			if err := propagateVisibilityBatch(conn, indexed); err != nil {
				return err
			}

			return idx.runIndexedHook(conn, indexed)
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

// IsPublicCID reports whether a stored blob is marked as public.
func (idx *Index) IsPublicCID(ctx context.Context, c cid.Cid) (bool, error) {
	return sqlitex.Read(ctx, idx.db, func(conn *sqlite.Conn) (bool, error) {
		res, err := dbBlobsGet(conn, c.Hash(), false)
		if err != nil {
			return false, err
		}
		return res.ID != 0 && res.IsPublic, nil
	})
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
