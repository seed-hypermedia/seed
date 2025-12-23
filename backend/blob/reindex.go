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
	storage.T_Resources,
	storage.T_Spaces,
	storage.T_DocumentGenerations,
	storage.T_StashedBlobs,
	storage.T_Fts,
	storage.T_FtsIndex,
	storage.T_BlobVisibility,
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
	conn, release, err := idx.db.Conn(ctx)
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
		blobsTotal   int64
		blobsIndexed int64
	)
	defer func() {
		idx.reindexing.state.Store(int32(ReindexStateCompleted)) //nolint:gosec
		idx.reindexing.blobsIndexed.Store(blobsIndexed)

		idx.log.Info("ReindexingFinished",
			zap.Error(err),
			zap.String("duration", time.Since(start).String()),
			zap.Int64("blobsTotal", blobsTotal),
			zap.Int64("blobsIndexed", blobsIndexed),
			zap.Int64("blobsSkipped", blobsTotal-blobsIndexed),
		)
	}()

	if err := sqlitex.WithTx(conn, func() error {
		for _, table := range derivedTables {
			if err := sqlitex.ExecTransient(conn, "DELETE FROM "+table, nil); err != nil {
				return err
			}
		}

		blobsTotal, err = sqlitex.QueryOne[int64](conn, "SELECT count() FROM blobs")
		if err != nil {
			return err
		}

		idx.reindexing.blobsTotal.Store(blobsTotal)
		idx.log.Info("ReindexingStarted", zap.Int64("blobsTotal", blobsTotal))

		const q = "SELECT * FROM blobs WHERE codec IN (?, ?) AND size > 0 ORDER BY id"
		args := []any{
			uint64(multicodec.DagCbor),
			uint64(multicodec.DagPb),
		}

		scratch := make([]byte, 0, 1024*1024) // 1MB preallocated slice to reuse for decompressing.
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

			err = indexBlob(false, conn, id, c, data, idx.bs, idx.log)
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

		return dbSetReindexTime(conn, time.Now().UTC().String())
	}); err != nil {
		return err
	}

	return nil
}

// MaybeReindex will trigger reindexing of the entire database if needed,
// i.e. if we've reset the last index timestamp in a migration.
func (idx *Index) MaybeReindex(ctx context.Context) error {
	conn, release, err := idx.db.Conn(ctx)
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
