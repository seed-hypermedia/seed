package blob

import (
	"context"
	"seed/backend/ipfs"
	"seed/backend/util/sqlite"
	"seed/backend/util/syncperf"
	"slices"
	"time"

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

	fromNetwork := networkOrigin(ctx)
	opts := indexOpts{
		TrackUnreads:            unreadsTrackingEnabled(ctx),
		FromNetwork:             fromNetwork,
		DeriveFirstContentImage: idx.firstImageDeriver(),
	}
	if fromNetwork {
		opts.ObservedAt = time.Now()
	}

	// hookIDs collects this blob plus any older blobs the unstash cascade
	// re-indexes, so the maintained RBSR index sees them all. Enqueued for the
	// asynchronous hook only after the transaction commits.
	hookIDs := make([]int64, 0, 1)
	var wrote bool
	var kinds []syncperf.KindSample
	if fromNetwork {
		opts.Kinds = &kinds
	}
	if err := sqlitex.WithTx(conn, func() error {
		codec, hash := ipfs.DecodeCID(blk.Cid())
		id, exists, err := idx.bs.putBlock(conn, 0, uint64(codec), hash, blk.RawData())
		if err != nil {
			return err
		}
		wrote = !exists

		if exists || !isIndexable(multicodec.Code(codec)) {
			if wrote && fromNetwork {
				kinds = append(kinds, syncperf.KindSample{
					Space: syncSpace(ctx),
					Kind:  syncperf.KindMedia,
					Bytes: int64(len(blk.RawData())),
				})
			}
			return nil
		}

		// Single-blob path: a fresh per-call cache (no cross-blob reuse to exploit).
		return indexBlob(opts, conn, id, blk.Cid(), blk.RawData(), idx.bs, idx.log, newWriterValidityCache(), &hookIDs)
	}); err != nil {
		return err
	}

	// Only after the commit: a rolled-back transaction wrote nothing.
	if fromNetwork && wrote {
		syncperf.Default.RecordWrite(1, int64(len(blk.RawData())))
		syncperf.Default.RecordKinds(kinds)
	}

	idx.enqueueIndexedHook(hookIDs)
	return nil
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

	fromNetwork := networkOrigin(ctx)
	// Raw media never reaches the indexer, so it can't learn its space the way
	// structural blobs do. The syncing session that pulled it does know, and
	// passes it down here — see blob.ContextWithSyncSpace.
	mediaSpace := syncSpace(ctx)
	opts := indexOpts{
		TrackUnreads:            unreadsTrackingEnabled(ctx),
		DeferPropagation:        true,
		FromNetwork:             fromNetwork,
		DeriveFirstContentImage: idx.firstImageDeriver(),
	}

	for batch := range slices.Chunk(blks, batchSize) {
		conn, release, err := idx.db.WriteConn(ctx)
		if err != nil {
			return err
		}

		// One arrival timestamp per batch transaction rather than per blob:
		// the batch holds the write lock ~150ms while delays are measured in
		// seconds, so the extra precision would be noise.
		if fromNetwork {
			opts.ObservedAt = time.Now()
		}

		// One writer-validity cache per batch transaction: shared across this
		// batch's blobs and the reindex cascade they trigger, so a late capability
		// that unstashes many same-writer Refs runs the costly transitive query
		// once instead of per blob. Safe because the batch tx is single-threaded
		// over a consistent snapshot. See writerValidityCache.
		wc := newWriterValidityCache()
		// hookIDs captures every blob indexed in this batch — including ones
		// re-indexed by the unstash cascade (which self-propagate visibility,
		// so they're not in `indexed`) — for the asynchronous RBSR index hook.
		// Enqueued only after this batch's transaction commits.
		hookIDs := make([]int64, 0, len(batch))
		// putBlock already tells us which blobs actually reached the disk, so
		// throughput accounting is a pair of adds in a loop we already run —
		// no extra query, and blobs bounced as "exists" (which wrote nothing)
		// are excluded for free.
		var wroteBlobs, wroteBytes int64
		// kinds is filled by SaveBlob for indexable blobs (which know their type
		// and space) and here for raw media (which never reaches the indexer).
		// Flushed only after the commit.
		var kinds []syncperf.KindSample
		if fromNetwork {
			opts.Kinds = &kinds
		}
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
				indexable := isIndexable(multicodec.Code(codec))
				if !exists {
					wroteBlobs++
					wroteBytes += int64(len(blk.RawData()))
					// Raw media never reaches the indexer, so this is its only
					// chance to be counted. It carries no space either: a raw
					// block is reached by walking links out of a document, and
					// that document isn't in scope by the time it lands here.
					if !indexable && fromNetwork {
						kinds = append(kinds, syncperf.KindSample{
							Space: mediaSpace,
							Kind:  syncperf.KindMedia,
							Bytes: int64(len(blk.RawData())),
						})
					}
				}

				if exists || !indexable {
					continue
				}

				if err := indexBlob(opts, conn, id, blk.Cid(), blk.RawData(), idx.bs, idx.log, wc, &hookIDs); err != nil {
					return err
				}
				indexed = append(indexed, id)
			}

			return propagateVisibilityBatch(conn, indexed)
		})
		release()
		if err != nil {
			return err
		}

		// Only after the commit: a rolled-back batch wrote nothing.
		if fromNetwork {
			syncperf.Default.RecordWrite(wroteBlobs, wroteBytes)
			syncperf.Default.RecordKinds(kinds)
		}

		idx.enqueueIndexedHook(hookIDs)
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
