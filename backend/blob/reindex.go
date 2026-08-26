package blob

import (
	"context"
	"fmt"
	"seed/backend/storage"
	"slices"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
)

// Order is important to ensure foreign key constraints are not violated.
var derivedTables = []string{
	storage.T_BlobLinks,
	storage.T_ResourceLinks,
	storage.T_StructuralBlobs,
	storage.T_DocumentAttributes,
	storage.T_DocumentAttributeKeys,
	storage.T_Resources,
	storage.T_Spaces,
	storage.T_DocumentGenerations,
	storage.T_StashedBlobs,
	storage.T_Embeddings,
	storage.T_EmbeddingsIndex,
	storage.T_Fts,
	storage.T_FtsIndex,
	storage.T_BlobVisibility,
	// The maintained RBSR index is derived: drop it on reindex and let it
	// re-materialize lazily on the next reconcile. rbsr_item has an FK to
	// rbsr_scope with ON DELETE CASCADE, but reindex deletes tables in list
	// order, so list rbsr_item before rbsr_scope to avoid relying on cascade.
	storage.T_RbsrItem,
	storage.T_RbsrScope,
}

// ReindexState represents the state of the initial re-indexing process.
type ReindexState byte

// Reindexing states.
const (
	ReindexStatePending ReindexState = iota
	ReindexStateInProgress
	ReindexStateCompleted
	ReindexStateNotNeeded // Index is up to date. No reindexing is needed.
)

// ReindexInfo provides information about the **initial** reindexing process.
type ReindexInfo struct {
	State        ReindexState
	BlobsTotal   int64
	BlobsIndexed int64
}

// ReindexInfo provides information about the **initial** reindexing process at the time of the call.
// This call is thread-safe because it's using atomics.
func (idx *Index) ReindexInfo() ReindexInfo {
	return ReindexInfo{
		State:        ReindexState(idx.reindexing.state.Load()), //nolint:gosec
		BlobsTotal:   idx.reindexing.blobsTotal.Load(),
		BlobsIndexed: idx.reindexing.blobsIndexed.Load(),
	}
}

// Reindex the entire database. Usually needed only after migrations.
func (idx *Index) Reindex(ctx context.Context) (err error) {
	conn, release, err := idx.db.WriteConn(ctx)
	if err != nil {
		return err
	}
	defer release()

	return idx.reindex(conn)
}

func (idx *Index) reindex(conn *sqlite.Conn) (err error) {
	// Prevent concurrent reindexing.
	// Just in case.
	if !idx.mu.TryLock() {
		return nil
	}
	defer idx.mu.Unlock()

	idx.reindexing.state.Store(int32(ReindexStateInProgress)) //nolint:gosec

	start := time.Now()
	var (
		blobsTotal     int64 // Every blob in the store.
		blobsIndexable int64 // The subset the loop below visits; drives progress reporting.
		blobsIndexed   int64

		// Phase timings and cover-pass counters, so a slow reindex can be
		// diagnosed from the completion log alone, without a CPU profile.
		truncateDur, blobLoopDur, coverDur           time.Duration
		gensScanned, gensDerived, coverChangesReplay int
	)
	defer func() {
		idx.reindexing.state.Store(int32(ReindexStateCompleted)) //nolint:gosec
		idx.reindexing.blobsIndexed.Store(blobsIndexed)

		idx.log.Info("ReindexingFinished",
			zap.Error(err),
			zap.String("duration", time.Since(start).String()),
			zap.Int64("blobsTotal", blobsTotal),
			zap.Int64("blobsIndexable", blobsIndexable),
			zap.Int64("blobsIndexed", blobsIndexed),
			zap.Int64("blobsSkipped", blobsTotal-blobsIndexed),
			zap.String("truncateDuration", truncateDur.String()),
			zap.String("blobLoopDuration", blobLoopDur.String()),
			zap.String("coverPassDuration", coverDur.String()),
			zap.Int("generationsScanned", gensScanned),
			zap.Int("generationsDerived", gensDerived),
			zap.Int("coverChangesReplayed", coverChangesReplay),
		)
	}()

	// Resolved once instead of once per blob: the reindex holds the only write
	// connection for its entire duration, so this can't meaningfully change
	// mid-run, and firstImageDeriver() takes a RWMutex on every call.
	deriver := idx.firstImageDeriver()

	if err := sqlitex.WithTx(conn, func() error {
		truncateStart := time.Now()
		for _, table := range derivedTables {
			if err := sqlitex.ExecTransient(conn, "DELETE FROM "+table, nil); err != nil {
				return err
			}
		}
		truncateDur = time.Since(truncateStart)

		// Only blobs we can actually decode are visited; everything else (raw
		// blobs, and blobs whose data we don't have) is filtered out in SQL.
		const indexableFilter = "codec IN (?, ?) AND size > 0"
		args := []any{
			uint64(multicodec.DagCbor),
			uint64(multicodec.DagPb),
		}

		blobsTotal, err = sqlitex.QueryOne[int64](conn, "SELECT count() FROM blobs")
		if err != nil {
			return err
		}

		blobsIndexable, err = sqlitex.QueryOne[int64](conn, "SELECT count() FROM blobs WHERE "+indexableFilter, args...)
		if err != nil {
			return err
		}

		// The progress denominator must be what the loop will actually visit, not
		// the size of the blobs table. Roughly a third of a real database is raw
		// blobs the loop never touches, so reporting the unfiltered total made the
		// progress bar stop dead around 68% and then jump straight to done — which
		// reads as the reindex crashing rather than finishing.
		idx.reindexing.blobsTotal.Store(blobsIndexable)
		idx.log.Info("ReindexingStarted",
			zap.Int64("blobsTotal", blobsTotal),
			zap.Int64("blobsIndexable", blobsIndexable),
		)

		const q = "SELECT * FROM blobs WHERE " + indexableFilter + " ORDER BY id"

		// One writer-validity cache for the whole reindex: the entire pass runs in
		// this single transaction over one consistent snapshot, single-threaded, and
		// indexCapability clears it whenever a capability is (re)indexed — so it is
		// safe to share across every blob and collapses the repeated transitive
		// writer query the same way the sync path does. See writerValidityCache.
		reindexWriterCache := newWriterValidityCache()

		scratch := make([]byte, 0, 1024*1024) // 1MB preallocated slice to reuse for decompressing.
		blobLoopStart := time.Now()
		if err := sqlitex.ExecTransient(conn, q, func(stmt *sqlite.Stmt) error {
			codec := stmt.ColumnInt64(stmt.ColumnIndex(storage.BlobsCodec.ShortName()))

			id := stmt.ColumnInt64(stmt.ColumnIndex(storage.BlobsID.ShortName()))
			hash := stmt.ColumnBytes(stmt.ColumnIndex(storage.BlobsMultihash.ShortName()))
			size := stmt.ColumnInt(stmt.ColumnIndex(storage.BlobsSize.ShortName()))
			compressed := stmt.ColumnBytesUnsafe(stmt.ColumnIndex(storage.BlobsData.ShortName()))

			scratch = scratch[:0]
			scratch = slices.Grow(scratch, size)
			scratch, err = idx.bs.decoder.DecodeAll(compressed, scratch)
			if err != nil {
				return fmt.Errorf("failed to decompress block: %w", err)
			}

			c := cid.NewCidV1(uint64(codec), hash)
			data := make([]byte, len(scratch))
			if copy(data, scratch) != len(scratch) {
				return fmt.Errorf("BUG: failed to clone decompressed data: %s", c)
			}

			// Full reindex rebuilds the derived tables (incl. the RBSR index) from
			// scratch, so no incremental hook is needed here — pass nil.
			//
			// A nil DeriveFirstContentImage is load-bearing, not an omission: it is
			// what disables the per-Ref fallback-cover derivation, which replays a
			// document's entire history on every Ref that advances its heads and so
			// costs O(refs × changes) across a full reindex. deriveFirstContentImages
			// below does the same work once per generation after the loop. The nil
			// also rides into the unstash cascade via childOpts(), which is what we
			// want — the end pass covers every generation regardless of how it got
			// built.
			err = indexBlob(indexOpts{}, conn, id, c, data, idx.bs, idx.log, reindexWriterCache, nil)
			blobsIndexed++

			// We batch updates for progress reporting.
			// The chosen number is a bit arbitrary.
			const reportBatchSize = 30
			if blobsIndexed%reportBatchSize == 0 {
				idx.reindexing.blobsIndexed.Store(blobsIndexed)
			}

			return err
		}, args...); err != nil {
			return err
		}
		blobLoopDur = time.Since(blobLoopStart)

		coverStart := time.Now()
		gensScanned, gensDerived, coverChangesReplay, err = deriveFirstContentImages(conn, idx.bs, idx.log, deriver)
		if err != nil {
			return err
		}
		coverDur = time.Since(coverStart)

		return dbSetReindexTime(conn, time.Now().UTC().String())
	}); err != nil {
		return err
	}

	return nil
}

// MaybeReindex will trigger reindexing of the entire database if needed,
// i.e. if we've reset the last index timestamp in a migration.
func (idx *Index) MaybeReindex(ctx context.Context) error {
	conn, release, err := idx.db.WriteConn(ctx)
	if err != nil {
		return err
	}
	defer release()

	res, err := dbGetReindexTime(conn)
	if err != nil {
		return err
	}

	if res != "" {
		idx.reindexing.state.Store(int32(ReindexStateNotNeeded)) //nolint:gosec
		return nil
	}

	return idx.reindex(conn)
}
