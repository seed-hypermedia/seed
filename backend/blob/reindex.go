package blob

import (
	"context"
	"fmt"
	daemon "seed/backend/genproto/daemon/v1alpha"
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
	storage.T_PublicBlobs,
}

// Reindex forces deletes all the information derived from the blobs and reindexes them.
func (idx *Index) Reindex(ctx context.Context) (err error) {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	return idx.reindex(conn)
}

func (idx *Index) reindex(conn *sqlite.Conn) (err error) {
	if !idx.mu.TryLock() {
		return nil
	}
	defer idx.mu.Unlock()

	start := time.Now()
	var (
		blobsTotal   int
		blobsIndexed int
	)
	idx.log.Info("ReindexingStarted")
	const taskID = "blob_reindex"
	if idx.taskMgr != nil {
		prevState := idx.taskMgr.GlobalState()
		idx.taskMgr.UpdateGlobalState(daemon.State_MIGRATING)
		_, err := idx.taskMgr.AddTask(taskID, daemon.TaskName_REINDEXING, "Reindexing blobs")
		if err != nil {
			idx.log.Warn("Failed to create reindexing task", zap.Error(err))
		}
		defer func() {
			if err == nil {
				idx.taskMgr.DeleteTask(taskID)
			}
			idx.taskMgr.UpdateGlobalState(prevState)
		}()
	}
	defer func() {
		idx.log.Info("ReindexingFinished",
			zap.Error(err),
			zap.String("duration", time.Since(start).String()),
			zap.Int("blobsTotal", blobsTotal),
			zap.Int("blobsIndexed", blobsIndexed),
			zap.Int("blobsSkipped", blobsTotal-blobsIndexed),
		)
	}()

	if err := sqlitex.WithTx(conn, func() error {
		for _, table := range derivedTables {
			if err := sqlitex.ExecTransient(conn, "DELETE FROM "+table, nil); err != nil {
				return err
			}
		}

		blobsTotal, err = sqlitex.QueryOne[int](conn, "SELECT count() FROM blobs")
		if err != nil {
			return err
		}

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
			if idx.taskMgr != nil {
				idx.taskMgr.UpdateProgress(taskID, float64(blobsIndexed)/float64(blobsTotal))
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

// MaybeReindex will trigger reindexing if it's needed.
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
		return nil
	}

	return idx.reindex(conn)
}
