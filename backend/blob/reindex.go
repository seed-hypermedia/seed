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
	defer func() {
		idx.log.Info("ReindexingFinished",
			zap.Error(err),
			zap.Duration("duration", time.Since(start)),
			zap.Int("blobsTotal", blobsTotal),
			zap.Int("blobsIndexed", blobsIndexed),
		)
	}()

	if err := sqlitex.WithTx(conn, func() error {
		for _, table := range derivedTables {
			if err := sqlitex.ExecTransient(conn, "DELETE FROM "+table, nil); err != nil {
				return err
			}
		}

		scratch := make([]byte, 0, 1024*1024) // 1MB preallocated slice to reuse for decompressing.
		if err := sqlitex.ExecTransient(conn, "SELECT * FROM blobs ORDER BY id", func(stmt *sqlite.Stmt) error {
			codec := stmt.ColumnInt64(stmt.ColumnIndex(storage.BlobsCodec.ShortName()))
			blobsTotal++

			if !isIndexable(multicodec.Code(codec)) {
				return nil
			}

			id := stmt.ColumnInt64(stmt.ColumnIndex(storage.BlobsID.ShortName()))
			hash := stmt.ColumnBytes(stmt.ColumnIndex(storage.BlobsMultihash.ShortName()))
			size := stmt.ColumnInt(stmt.ColumnIndex(storage.BlobsSize.ShortName()))
			compressed := stmt.ColumnBytesUnsafe(stmt.ColumnIndex(storage.BlobsData.ShortName()))
			// We have to skip blobs we know the hashes of but we don't have the data.
			// Also the blobs that are inline (data stored in the hash itself) because we don't index them ever.
			// TODO(burdiyan): filter the select query to avoid fetching these blobs in the first place.
			if size <= 0 {
				return nil
			}

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

			blobsIndexed++
			return indexBlob(false, conn, id, c, data, idx.bs, idx.log)
		}); err != nil {
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
