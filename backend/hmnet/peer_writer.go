package hmnet

import (
	"context"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"go.uber.org/zap"
)

// peerWriter owns all writes to the peers table that originate from
// libp2p identification events. It exists to keep the libp2p event-loop
// goroutine off the SQLite writer slot: handlers enqueue a job and
// return immediately; the writer goroutine batches outstanding jobs and
// commits them in one BEGIN IMMEDIATE / COMMIT cycle.
//
// Before this refactor, onLibp2pIdentification ran the INSERT inline on
// the single goroutine that drains the libp2p event bus. When that INSERT
// queued behind a slow holder of the writer slot, every subsequent event
// on the bus stalled too — connection events, identifications, peer-table
// updates, all serialised behind one slow COMMIT. The /debug/sqlite page
// showed onLibp2pIdentification as a top recent-slow caller for exactly
// this reason: it wasn't intrinsically slow, it was queueing behind
// itself + every event that piled up while one identify handler waited.
//
// Architectural property: the dispatcher (handleLibp2pEvents) still runs
// the cheap pre-checks inline — connectedness, protocol version,
// peerWriteIsRedundant — so we only enqueue events that will actually
// write. The DB write itself is amortised across a batch, so a burst of
// N identifications turns into one COMMIT, not N COMMITs. That bound
// holds even under contention because the writer is a single goroutine,
// not a worker pool: no internal concurrency means no in-flight queueing
// at BEGIN IMMEDIATE from our own code.
type peerWriter struct {
	db    *sqlitex.Pool
	log   *zap.Logger
	queue chan peerWriteJob
}

// peerWriteJob carries the bind args for one INSERT INTO peers row. It's
// a value type so the writer goroutine doesn't accidentally see mutations
// after the dispatcher returns.
type peerWriteJob struct {
	pid                 string
	addrs               string
	explicitlyConnected bool
}

const (
	// peerWriterQueueSize caps the in-flight buffer of identify-driven
	// peer-table writes. A burst above this many events in less than one
	// batch cycle will start back-pressuring the dispatcher (channel
	// send blocks). Under steady state we'd expect a few writes per
	// second; bursts during a peer-exchange storm or a daemon restart
	// can hit 200+/s briefly. 1024 absorbs ~5 s of burst before the
	// dispatcher blocks, which is the same back-pressure shape the
	// pre-refactor inline code already had, just with the bar moved up.
	peerWriterQueueSize = 1024

	// peerWriterMaxBatch caps how many jobs we coalesce into one
	// BEGIN IMMEDIATE / COMMIT cycle. Each INSERT in the batch is tiny
	// (1 row, ON CONFLICT bump) so the linear cost of N inserts inside
	// one tx is dominated by the COMMIT/fsync — that's the cost we're
	// amortising. 32 batches comfortably without holding the writer
	// slot long enough to starve other callers.
	peerWriterMaxBatch = 32

	// peerWriterFlushDelay is how long we wait for more jobs to arrive
	// after the first job in a batch before committing what we have.
	// Short enough that a single isolated identification is committed
	// within a humanly-imperceptible window; long enough to coalesce
	// the dispatcher's per-event sends from a typical peer-exchange
	// burst (where the bus delivers ~10 events back-to-back over a
	// few ms).
	peerWriterFlushDelay = 25 * time.Millisecond
)

// newPeerWriter constructs a writer. The returned writer must have
// run(ctx) called on it from a dedicated goroutine; do not call run
// more than once.
func newPeerWriter(db *sqlitex.Pool, log *zap.Logger) *peerWriter {
	return &peerWriter{
		db:    db,
		log:   log,
		queue: make(chan peerWriteJob, peerWriterQueueSize),
	}
}

// enqueue submits a peer-write job for batched persistence. Blocks if
// the queue is full; the caller is expected to be the libp2p event-loop
// goroutine, so blocking it is equivalent to back-pressuring the bus,
// which is the existing pre-refactor behavior under heavy load.
func (w *peerWriter) enqueue(job peerWriteJob) {
	w.queue <- job
}

// run drains the queue, batching writes. Exits when ctx is cancelled OR
// when the queue is closed (whichever comes first). On exit, any
// already-collected batch is flushed best-effort.
func (w *peerWriter) run(ctx context.Context) {
	for {
		// Block until either the first job of a new batch arrives or
		// the goroutine is being torn down.
		var batch []peerWriteJob
		select {
		case job, ok := <-w.queue:
			if !ok {
				return
			}
			batch = append(batch, job)
		case <-ctx.Done():
			return
		}

		// Coalesce additional jobs into this batch, bounded by
		// peerWriterMaxBatch jobs and peerWriterFlushDelay wall time.
		// The timer fires once per batch; we don't reuse it across
		// batches so a stopped-and-fired timer is harmless.
		timer := time.NewTimer(peerWriterFlushDelay)
	fill:
		for len(batch) < peerWriterMaxBatch {
			select {
			case job, ok := <-w.queue:
				if !ok {
					timer.Stop()
					w.flush(ctx, batch)
					return
				}
				batch = append(batch, job)
			case <-timer.C:
				break fill
			case <-ctx.Done():
				timer.Stop()
				// ctx is already cancelled — give the flush a
				// fresh background ctx so the pending batch
				// still lands.
				w.flush(context.Background(), batch)
				return
			}
		}
		timer.Stop()

		w.flush(ctx, batch)
	}
}

// flush commits the batch under a single writer-slot scope. Failure here
// is logged but otherwise swallowed: the dispatcher already returned and
// has no error path to propagate to, and the rows can be re-derived from
// the next identification event the peer triggers (Connect / re-identify
// loop on the libp2p side). This is the same loss-tolerance the
// pre-refactor inline write had — that path also only logged the error.
func (w *peerWriter) flush(ctx context.Context, batch []peerWriteJob) {
	if len(batch) == 0 {
		return
	}
	const insertStmt = "INSERT INTO peers (pid, addresses, explicitly_connected) VALUES (?, ?, ?) ON CONFLICT(pid) DO UPDATE SET addresses=CASE WHEN excluded.addresses!='' THEN excluded.addresses ELSE addresses END, updated_at=strftime('%s', 'now');"
	if err := w.db.WithTx(ctx, func(conn *sqlite.Conn) error {
		for _, j := range batch {
			if err := sqlitex.Exec(conn, insertStmt, nil, j.pid, j.addrs, j.explicitlyConnected); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		w.log.Warn("PeerWriterBatchFailed",
			zap.Int("batch_size", len(batch)),
			zap.Error(err))
	}
}
