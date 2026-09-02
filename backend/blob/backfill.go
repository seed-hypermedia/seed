package blob

import (
	"context"
	"time"

	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"go.uber.org/zap"
)

// The derived document fields (see DerivedDocFields) are rolled out to existing
// documents by this asynchronous backfill rather than by a migration-scheduled
// full reindex.
//
// A full reindex truncates every derived table and rebuilds them from every
// blob inside a single write transaction, holding the only write connection for
// its whole duration and blocking daemon startup in State_MIGRATING. That is
// the right hammer for a field the read path cannot function without. It is the
// wrong one here: an underived Collection flag simply reads as "not known to be a
// Collection", and new and updated documents get the field on the ordinary write
// path regardless. Only history needs filling in, and it can be filled in
// without blocking startup.
//
// So this runs like the embedding indexer instead: bounded batches, one
// transaction each, a sleep between passes, off the startup path entirely.
// The blast radius of a bad document is one batch rather than the whole
// database — which is exactly the failure that made the fallback-cover reindex
// crash-loop the daemon on any node holding one oversized blob.

const (
	// DefaultDocFieldsBackfillBatchSize is how many document generations one
	// backfill transaction derives. Each generation replays its full change
	// history, so this trades backfill throughput against how long a single pass
	// holds the write connection.
	DefaultDocFieldsBackfillBatchSize = 50

	// DefaultDocFieldsBackfillSleep is how long the worker waits between passes,
	// to leave the writer and the CPU available to live traffic.
	DefaultDocFieldsBackfillSleep = 2 * time.Second

	// maxDocFieldsBackfillFailures is how many consecutive failed passes the
	// worker tolerates before giving up for this process lifetime.
	maxDocFieldsBackfillFailures = 5
)

// DocFieldsBackfillOptions configures the asynchronous derived-fields backfill.
type DocFieldsBackfillOptions struct {
	// BatchSize is how many generations one pass derives. Zero means
	// DefaultDocFieldsBackfillBatchSize.
	BatchSize int

	// SleepPerPass is the pause between passes. Zero means
	// DefaultDocFieldsBackfillSleep.
	SleepPerPass time.Duration

	// Interval, when positive, re-checks for pending generations this long after
	// the backfill drains, instead of stopping. Normally unnecessary — the write
	// path derives for every new and updated document — but useful as a safety
	// net where derived rows can be dropped out from under the index.
	Interval time.Duration
}

func (o DocFieldsBackfillOptions) batchSize() int {
	if o.BatchSize <= 0 {
		return DefaultDocFieldsBackfillBatchSize
	}
	return o.BatchSize
}

func (o DocFieldsBackfillOptions) sleepPerPass() time.Duration {
	if o.SleepPerPass <= 0 {
		return DefaultDocFieldsBackfillSleep
	}
	return o.SleepPerPass
}

// StartDocFieldsBackfill runs the derived-fields backfill in the background
// until every pending generation is derived (or ctx is cancelled), then stops
// unless opts.Interval asks it to keep checking.
//
// Returns immediately. Safe to call when no deriver is installed: the worker
// finds nothing to do and exits.
func (idx *Index) StartDocFieldsBackfill(ctx context.Context, opts DocFieldsBackfillOptions) {
	go idx.runDocFieldsBackfill(ctx, opts)
}

func (idx *Index) runDocFieldsBackfill(ctx context.Context, opts DocFieldsBackfillOptions) {
	batchSize := opts.batchSize()
	sleep := opts.sleepPerPass()

	for {
		start := time.Now()
		var total, failures int

		for {
			if ctx.Err() != nil {
				return
			}

			n, err := idx.BackfillDocFields(ctx, batchSize)
			if err != nil {
				// A failing batch is not fatal: bad documents are already absorbed
				// one generation at a time, so an error out here is an infrastructure
				// problem — the write connection, the disk. Retry a few times, then
				// give up rather than warn in a loop for the life of the process.
				// Nothing is lost by stopping: the next daemon start picks the
				// backfill up exactly where it left off.
				failures++
				idx.log.Warn("DocFieldsBackfillPassFailed", zap.Int("consecutiveFailures", failures), zap.Error(err))
				if failures >= maxDocFieldsBackfillFailures {
					idx.log.Error("DocFieldsBackfillGaveUp", zap.Int("consecutiveFailures", failures))
					return
				}
			} else {
				failures = 0
				total += n
				if n == 0 {
					break
				}
			}

			select {
			case <-ctx.Done():
				return
			case <-time.After(sleep):
			}
		}

		if total > 0 {
			idx.log.Info("DocFieldsBackfillCompleted",
				zap.Int("generationsDerived", total),
				zap.String("duration", time.Since(start).String()),
			)
		}

		if opts.Interval <= 0 {
			return
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(opts.Interval):
		}
	}
}

// BackfillDocFields derives the document-level derived fields for up to limit
// generations that don't have them yet, in one transaction. Returns how many
// generations it derived; zero means the backfill has drained.
func (idx *Index) BackfillDocFields(ctx context.Context, limit int) (processed int, err error) {
	derive := idx.docFieldsDeriver()
	if derive == nil {
		return 0, nil
	}

	conn, release, err := idx.db.WriteConn(ctx)
	if err != nil {
		return 0, err
	}
	defer release()

	if err := sqlitex.WithTx(conn, func() error {
		keys, err := pendingDocFieldGenerations(conn, limit)
		if err != nil {
			return err
		}

		for _, k := range keys {
			if _, _, err := deriveDocFieldsForGeneration(conn, idx.bs, idx.log, derive, k); err != nil {
				return err
			}
			processed++
		}

		return nil
	}); err != nil {
		return 0, err
	}

	return processed, nil
}

// pendingDocFieldGenerations lists generations whose derived fields haven't been
// computed, cheapest-to-probe first.
//
// Presence of the IsCollectionAttr row *is* the bookkeeping — there is no
// separate progress table to keep in sync, and a generation that fails to derive
// still records the zero value (see deriveDocFieldsForGeneration), so a document
// the model cannot rebuild is retried never rather than forever.
//
// Restricted to each resource's latest generation because that is the only one
// whose attributes documentGeneration.save persists; scanning older generations
// would derive them, store nothing, and see them pending again on the next pass.
func pendingDocFieldGenerations(conn *sqlite.Conn, limit int) (keys []generationKey, err error) {
	// Resolve the interned attribute key once. Until the first derivation
	// interns it the row does not exist, and every generation is pending — which
	// the sentinel below expresses without special-casing the query.
	keyID := int64(-1)
	if err := sqlitex.Exec(conn, qDocFieldsAttrKeyID(), func(row *sqlite.Stmt) error {
		keyID = row.ColumnInt64(0)
		return nil
	}, IsCollectionAttr); err != nil {
		return nil, err
	}

	rows, discard, check := sqlitex.Query(conn, qPendingDocFieldGenerations(), keyID, limit).All()
	defer discard(&err)
	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		keys = append(keys, generationKey{
			Resource:   row.ColumnInt64(inc()),
			Generation: row.ColumnInt64(inc()),
			Genesis:    row.ColumnText(inc()),
			IRI:        IRI(row.ColumnText(inc())),
		})
	}
	if err := check(); err != nil {
		return nil, err
	}

	return keys, nil
}

var qDocFieldsAttrKeyID = dqb.Str(`
	SELECT id FROM document_attribute_keys WHERE key = ?;
`)

// The NOT EXISTS probes document_attributes on its (resource, key) primary key,
// so pending generations are found without scanning the attribute table.
var qPendingDocFieldGenerations = dqb.Str(`
	SELECT
		dg.resource,
		dg.generation,
		dg.genesis,
		r.iri
	FROM document_generations dg
	JOIN resources r ON r.id = dg.resource
	WHERE json_array_length(dg.heads) > 0
	AND dg.generation = (
		SELECT MAX(generation) FROM document_generations g WHERE g.resource = dg.resource
	)
	AND NOT EXISTS (
		SELECT 1 FROM document_attributes da
		WHERE da.resource = dg.resource AND da.key = ?
	)
	ORDER BY dg.resource
	LIMIT ?;
`)
