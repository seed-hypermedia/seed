package storage

import (
	"errors"
	"io"
	"sync"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.uber.org/zap"
)

// mWALBytesWritten is the physical volume the database has actually written to
// the main file: every WAL frame the checkpointer copies, times the page size.
// It costs nothing to collect — the checkpoint pragma already returns the frame
// count and we were throwing it away — and it is the counterpart to the logical
// blob bytes counted in syncperf. The ratio between the two is write
// amplification: derived tables, indexes, and page rewrites.
var mWALBytesWritten = promauto.NewCounter(prometheus.CounterOpts{
	Name: "seed_sqlite_wal_written_bytes_total",
	Help: "Bytes checkpointed from the WAL into the main database file (all writers).",
})

// defaultCheckpointInterval is how often the background checkpointer flushes the
// WAL to the main database file. Because the flush runs PASSIVE on a dedicated
// connection it never stalls the pool's writer, so the interval only bounds how
// long frames sit in the WAL before being copied to the main db.
const defaultCheckpointInterval = 1 * time.Second

// walReclaimThresholdFrames is the WAL size (in pages) above which the
// checkpointer, once it has fully drained the WAL, reclaims the file with a
// TRUNCATE checkpoint. PASSIVE flushes frames but never shrinks the WAL file, so
// after a large (media) sync the file would otherwise sit at its high-water mark
// until the process exits. The structure sync keeps the WAL well under this, so
// the reclaim path only ever runs after large media bursts. At the 4 KiB default
// page size this is ~64 MiB.
const walReclaimThresholdFrames = 16384

type checkpointMode string

const (
	checkpointPassive  checkpointMode = "PASSIVE"
	checkpointTruncate checkpointMode = "TRUNCATE"
)

// walCheckpointer flushes the SQLite WAL to the main database file from a
// dedicated connection, keeping the expensive fsync off the pool's single
// writer.
//
// Why this exists: with journal_mode=WAL and synchronous=NORMAL, commits are
// cheap — they only append frames to the WAL — and the expensive fsync happens
// at checkpoint time. SQLite's default behavior auto-checkpoints inline on the
// connection whose commit crosses wal_autocheckpoint (~4MB by default). In the
// daemon that connection is the single pool writer, so during a cold sync the
// writer itself periodically stalls for seconds doing the checkpoint fsync — and
// because the frontend reads the DB constantly, a passive checkpoint can't
// reclaim the WAL, so it keeps growing and the eventual flush gets even longer.
// Measured stalls of 5-10s per commit dominated cold-sync wall-clock.
//
// The fix: the caller disables inline auto-checkpointing on the writer (PRAGMA
// wal_autocheckpoint=0) and lets this type run wal_checkpoint(PASSIVE) on a
// timer from a separate connection. PASSIVE never blocks readers or the writer;
// it copies whatever WAL frames it can up to the oldest reader mark and returns.
// The fsync cost moves off the write path onto this goroutine, so the writer's
// commits stay sub-millisecond. The two settings are a pair: with auto-checkpoint
// off and nothing flushing, the WAL would grow unbounded.
//
// PASSIVE flushes frames but never shrinks the WAL *file*. To avoid the file
// sitting at its high-water mark after a big media sync, the loop reclaims it
// with a one-shot TRUNCATE — but only once PASSIVE reports the WAL fully drained
// (so the reset is a pure file truncate that never waits on an active writer).
// We deliberately do NOT use journal_size_limit: pairing it with PASSIVE turned
// ordinary flushes into blocking resets and reintroduced multi-second writer
// stalls under media load.
type walCheckpointer struct {
	conn     *sqlite.Conn
	interval time.Duration
	log      *zap.Logger

	// pageSize is read once at construction so tick can convert checkpointed
	// frame counts into bytes without issuing a query per tick.
	pageSize int64

	stop chan struct{}
	done chan struct{}

	closeOnce sync.Once
	connErr   error

	// mu serializes access to conn (opened NOMUTEX) between the ticker goroutine
	// and any direct checkpoint caller (tests), and guards started/closed.
	mu      sync.Mutex
	started bool
	closed  bool
}

// newWALCheckpointer opens a dedicated read-write connection to the database at
// path for checkpointing. It does not start the background loop; call start.
func newWALCheckpointer(path string, interval time.Duration, log *zap.Logger) (*walCheckpointer, error) {
	conn, err := sqlite.OpenConn(path,
		sqlite.SQLITE_OPEN_READWRITE|
			sqlite.SQLITE_OPEN_WAL|
			sqlite.SQLITE_OPEN_URI|
			sqlite.SQLITE_OPEN_NOMUTEX,
	)
	if err != nil {
		return nil, err
	}

	// NORMAL is the right durability for checkpointing: the checkpoint fsyncs the
	// main db file after copying frames, which is exactly the work we want this
	// connection (not the writer) to absorb.
	if err := sqlitex.ExecTransient(conn, "PRAGMA synchronous = NORMAL;", nil); err != nil {
		return nil, errClose(conn, err)
	}

	// The only query this whole metrics feature adds: one pragma, once, on this
	// dedicated connection. It never touches the pool, so it cannot contend
	// with real reads or writes.
	var pageSize int64
	if err := sqlitex.ExecTransient(conn, "PRAGMA page_size;", func(stmt *sqlite.Stmt) error {
		pageSize = stmt.ColumnInt64(0)
		return nil
	}); err != nil {
		return nil, errClose(conn, err)
	}

	return &walCheckpointer{
		conn:     conn,
		interval: interval,
		log:      log,
		pageSize: pageSize,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}, nil
}

// start launches the background checkpoint loop.
func (c *walCheckpointer) start() {
	c.mu.Lock()
	c.started = true
	c.mu.Unlock()
	go c.run()
}

func (c *walCheckpointer) run() {
	defer close(c.done)

	t := time.NewTicker(c.interval)
	defer t.Stop()

	for {
		select {
		case <-c.stop:
			// One last flush + reclaim so a clean shutdown leaves the WAL drained
			// and the file small.
			if _, _, _, err := c.checkpoint(checkpointTruncate); err != nil {
				c.log.Debug("FinalWALCheckpointFailed", zap.Error(err))
			}
			return
		case <-t.C:
			c.tick()
		}
	}
}

// tick runs one PASSIVE flush and, if it fully drained a large WAL, reclaims the
// file. Split out from run so tests can drive a single cycle deterministically.
func (c *walCheckpointer) tick() {
	busy, walFrames, checkpointed, err := c.checkpoint(checkpointPassive)
	if err != nil {
		c.log.Debug("WALCheckpointFailed", zap.Error(err))
		return
	}
	if checkpointed > 0 {
		// PASSIVE only. tick may follow up with a TRUNCATE below, which reports
		// the same frames it just drained; counting both would double the figure.
		mWALBytesWritten.Add(float64(int64(checkpointed) * c.pageSize))
		c.log.Debug("WALCheckpoint",
			zap.Int("busy", busy),
			zap.Int("wal_frames", walFrames),
			zap.Int("checkpointed_frames", checkpointed),
		)
	}
	// The WAL grew large and PASSIVE has now copied every frame (busy==0 means no
	// reader/writer held it back). The writer has effectively paused, so a
	// TRUNCATE reset is a pure file truncate — reclaim the disk. During an active
	// burst PASSIVE leaves frames outstanding, so this never fires mid-write and
	// never blocks a commit.
	if busy == 0 && walFrames >= walReclaimThresholdFrames && checkpointed == walFrames {
		if _, _, _, err := c.checkpoint(checkpointTruncate); err != nil {
			c.log.Debug("WALReclaimFailed", zap.Error(err))
		}
	}
}

// checkpoint runs a single wal_checkpoint in the given mode and returns the
// pragma's three result columns: busy (1 if it could not fully complete because
// of an active reader/writer), the total WAL frame count, and the number of
// frames checkpointed into the main db.
func (c *walCheckpointer) checkpoint(mode checkpointMode) (busy, walFrames, checkpointed int, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return 0, 0, 0, nil
	}

	var query string
	switch mode {
	case checkpointTruncate:
		query = "PRAGMA wal_checkpoint(TRUNCATE);"
	default:
		query = "PRAGMA wal_checkpoint(PASSIVE);"
	}

	err = sqlitex.ExecTransient(c.conn, query, func(stmt *sqlite.Stmt) error {
		busy = stmt.ColumnInt(0)
		walFrames = stmt.ColumnInt(1)
		checkpointed = stmt.ColumnInt(2)
		return nil
	})
	return busy, walFrames, checkpointed, err
}

// Close stops the background loop, runs a final checkpoint, and closes the
// dedicated connection. It is safe to call more than once.
func (c *walCheckpointer) Close() error {
	c.closeOnce.Do(func() {
		c.mu.Lock()
		started := c.started
		c.mu.Unlock()
		// Only join the goroutine if it was ever started; otherwise c.done is
		// never closed and the receive would block forever.
		if started {
			close(c.stop)
			<-c.done
		}
		c.mu.Lock()
		c.closed = true
		c.connErr = c.conn.Close()
		c.mu.Unlock()
	})
	return c.connErr
}

// errClose closes c and joins any close error with the original err, so a
// failure during setup doesn't leak the connection (and trip its finalizer).
func errClose(c io.Closer, err error) error {
	return errors.Join(err, c.Close())
}
