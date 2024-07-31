package index

import (
	"context"
	"fmt"
	storage "seed/backend/storage2"
	"slices"
	"time"

	"crawshaw.io/sqlite"
	"crawshaw.io/sqlite/sqlitex"
	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
)

// Reindex forces deletes all the information derived from the blobs and reindexes them.
func (bs *Index) Reindex(ctx context.Context) (err error) {
	conn, release, err := bs.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	return bs.reindex(conn)
}

func (bs *Index) reindex(conn *sqlite.Conn) (err error) {
	start := time.Now()
	bs.log.Info("ReindexingStarted")
	defer func() {
		bs.log.Info("ReindexingFinished", zap.Error(err), zap.Duration("duration", time.Since(start)))
	}()

	// Order is important to ensure foreign key constraints are not violated.
	derivedTables := []string{
		storage.T_BlobLinks,
		storage.T_ResourceLinks,
		storage.T_StructuralBlobs,
		// Not deleting from resources yet, because they are referenced in the drafts table,
		// and we can't yet reconstruct the drafts table purely from the blobs.
		// storage.T_Resources,
	}

	const q = "SELECT * FROM " + storage.T_Blobs

	if err := sqlitex.WithTx(conn, func() error {
		for _, table := range derivedTables {
			if err := sqlitex.ExecTransient(conn, "DELETE FROM "+table, nil); err != nil {
				return err
			}
		}

		buf := make([]byte, 0, 1024*1024) // 1MB preallocated slice to reuse for decompressing.
		if err := sqlitex.ExecTransient(conn, q, func(stmt *sqlite.Stmt) error {
			codec := stmt.ColumnInt64(stmt.ColumnIndex(storage.BlobsCodec.ShortName()))

			if !isIndexable(multicodec.Code(codec)) {
				return nil
			}

			id := stmt.ColumnInt64(stmt.ColumnIndex(storage.BlobsID.ShortName()))
			hash := stmt.ColumnBytes(stmt.ColumnIndex(storage.BlobsMultihash.ShortName()))
			size := stmt.ColumnInt(stmt.ColumnIndex(storage.BlobsSize.ShortName()))
			data := stmt.ColumnBytesUnsafe(stmt.ColumnIndex(storage.BlobsData.ShortName()))
			// We have to skip blobs we know the hashes of but we don't have the data.
			// Also the blobs that are inline (data stored in the hash itself) because we don't index them ever.
			// TODO(burdiyan): filter the select query to avoid fetching these blobs in the first place.
			if size <= 0 {
				return nil
			}

			buf = buf[:0]
			buf = slices.Grow(buf, size)
			buf, err = bs.bs.decoder.DecodeAll(data, buf)
			if err != nil {
				return fmt.Errorf("failed to decompress block: %w", err)
			}

			c := cid.NewCidV1(uint64(codec), hash)
			hb, err := DecodeBlob(c, buf)
			if err != nil {
				bs.log.Warn("failed to decode blob for reindexing", zap.Error(err), zap.String("cid", c.String()))
				return nil
			}

			return bs.indexBlob(conn, id, hb.CID, hb.Decoded)
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
func (bs *Index) MaybeReindex(ctx context.Context) error {
	conn, release, err := bs.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	res, err := dbGetReindexTime(conn)
	if err != nil {
		return err
	}

	if res == "" {
		return bs.reindex(conn)
	}

	return nil
}
