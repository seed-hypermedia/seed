package blob

import (
	"context"
	"errors"
	"fmt"
	"seed/backend/storage"
	"slices"
	"time"

	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
)

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

		// Phase timings and batch counters, so a slow reindex can be
		// diagnosed from the completion log alone, without a CPU profile.
		truncateDur, blobLoopDur, flushDur time.Duration
		stats                              refStats
	)
	defer func() {
		// A failed rebuild has already committed the truncation, so the index
		// is empty: it stays InProgress, keeping syncing and blob storage
		// gated, and the cleared reindex time makes the next start redo it.
		if err == nil {
			idx.reindexing.state.Store(int32(ReindexStateCompleted)) //nolint:gosec
		}

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
			zap.String("flushDuration", flushDur.String()),
			zap.Int("generationsApplied", stats.Generations),
			zap.Int("generationsSeeded", stats.Seeded),
			zap.Int("changesApplied", stats.ChangesApplied),
			zap.Int("generationsDerived", stats.Derived),
			zap.Int("changesDerived", stats.ChangesDerived),
		)
	}()

	truncateStart := time.Now()

	if err := truncateDerivedTables(conn); err != nil {
		return err
	}

	truncateDur = time.Since(truncateStart)

	if err := sqlitex.WithTx(conn, func() error {
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

		// One batch for the whole reindex: it runs in this single transaction
		// over one consistent snapshot, and the deferred work of every blob is
		// done once per pass, when the batch flushes. See indexBatch.
		batch := newIndexBatch(idx.docFieldsDeriver())

		// Two passes over the same rows. The first indexes only capabilities,
		// then fills the members cache once, so the second pass authorizes
		// every other blob against complete grants instead of stashing blobs
		// signed before their capability's blob ID and evaluating the
		// authority graph per capability. A reset leaves no blob types, so the
		// first pass sniffs decompressed bytes, which costs well under a second.
		scratch := make([]byte, 0, 1024*1024) // 1MB preallocated slice to reuse for decompressing.
		blobLoopStart := time.Now()
		for _, capabilities := range []bool{true, false} {
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

				if mayBeCapability(multicodec.Code(codec), scratch) != capabilities {
					return nil
				}

				c := cid.NewCidV1(uint64(codec), hash)

				data := make([]byte, len(scratch))
				if copy(data, scratch) != len(scratch) {
					return fmt.Errorf("BUG: failed to clone decompressed data: %s", c)
				}

				// Full reindex rebuilds the derived tables (incl. the RBSR index) from
				// scratch, so no incremental hook is needed here — pass nil.
				err = indexBlob(indexOpts{}, conn, id, c, data, idx.bs, idx.log, batch, nil)
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

			flushStart := time.Now()

			if err := batch.flush(indexOpts{}, conn, idx.bs, idx.log, nil); err != nil {
				return err
			}

			flushDur += time.Since(flushStart)
		}
		blobLoopDur = time.Since(blobLoopStart) - flushDur
		stats = batch.stats

		return dbSetReindexTime(conn, time.Now().UTC().String())
	}); err != nil {
		return err
	}

	return nil
}

// truncateDerivedTables empties every derived table in a transaction of its
// own, ahead of the rebuild.
//
// It runs with foreign keys off, because SQLite only applies its truncate
// optimization, which frees a table's pages instead of deleting its rows one by
// one, when no foreign key constraint is enforced. On a production database the
// row-by-row deletes took about 40 seconds. Turning them off is safe because
// only derived tables reference derived tables, and every one of them is
// emptied here. Virtual tables (full-text search, embeddings) delete row by row
// regardless, so they are dropped and recreated from their stored definition.
//
// The same transaction clears the reindex time, so if the rebuild doesn't
// finish, the next start reindexes again instead of serving empty tables.
func truncateDerivedTables(conn *sqlite.Conn) (err error) {
	// PRAGMA foreign_keys has no effect inside a transaction, so it brackets it.
	if err := sqlitex.ExecTransient(conn, "PRAGMA foreign_keys = OFF;", nil); err != nil {
		return err
	}

	defer func() {
		err = errors.Join(err, sqlitex.ExecTransient(conn, "PRAGMA foreign_keys = ON;", nil))
	}()

	return sqlitex.WithTx(conn, func() error {
		for _, table := range storage.TableSpecs() {
			if table.Kind != storage.TableKindDerived {
				continue
			}

			createVirtual, err := virtualTableDefinition(conn, table.Name)
			if err != nil {
				return err
			}

			if createVirtual == "" {
				if err := sqlitex.ExecTransient(conn, "DELETE FROM "+table.Name, nil); err != nil {
					return err
				}

				continue
			}

			if err := sqlitex.ExecTransient(conn, "DROP TABLE "+table.Name, nil); err != nil {
				return err
			}

			if err := sqlitex.ExecTransient(conn, createVirtual, nil); err != nil {
				return fmt.Errorf("failed to recreate virtual table %s: %w", table.Name, err)
			}
		}

		return dbSetReindexTime(conn, "")
	})
}

// virtualTableDefinition returns the CREATE statement of a virtual table, or ""
// if the table is an ordinary one.
func virtualTableDefinition(conn *sqlite.Conn, table string) (sql string, err error) {
	rows, discard, check := sqlitex.Query(conn, qVirtualTableDefinition(), table).All()
	defer discard(&err)
	for row := range rows {
		sql = row.ColumnText(0)
		break
	}

	return sql, check()
}

var qVirtualTableDefinition = dqb.Str(`
	SELECT sql FROM sqlite_master
	WHERE type = 'table' AND name = ?1 AND sql LIKE 'CREATE VIRTUAL TABLE%';
`)

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
