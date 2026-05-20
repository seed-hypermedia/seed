package hmnet

import (
	"context"
	"fmt"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestPeerWriterPersistsBurst verifies the architectural property the
// fire-and-forget refactor relies on: a burst of N enqueues from one or
// many "dispatcher" goroutines lands in the peers table within a tight
// wall-clock budget, even though the writer goroutine batches them.
//
// Under the old inline design, N events meant N BEGIN IMMEDIATE / COMMIT
// cycles serialised through the writer slot. Under the worker pool, N
// events meant up to 8 concurrent attempts at BEGIN IMMEDIATE — also
// serialised by SQLite, just with more queueing visible. Under
// fire-and-forget, N events should collapse into ⌈N/maxBatch⌉ COMMITs
// because the single writer coalesces them through the buffered channel.
func TestPeerWriterPersistsBurst(t *testing.T) {
	db := storage.MakeTestDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	w := newPeerWriter(db, zap.NewNop())
	done := make(chan struct{})
	go func() { defer close(done); w.run(ctx) }()

	const n = 100
	t0 := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			pid := fmt.Sprintf("12D3KooW_peerwriter_test_%03d", i)
			addrs := fmt.Sprintf("/ip4/127.0.0.1/tcp/%d/p2p/%s", 40000+i, pid)
			w.enqueue(peerWriteJob{
				pid:                 pid,
				addrs:               addrs,
				explicitlyConnected: false,
			})
		}()
	}
	wg.Wait()

	// Poll until all rows are visible. With peerWriterFlushDelay=25ms
	// and maxBatch=32, 100 rows fit in ⌈100/32⌉=4 batches — well under
	// a second on any sane disk.
	const budget = 2 * time.Second
	deadline := time.Now().Add(budget)
	for {
		rows, err := countPeers(ctx, db)
		require.NoError(t, err)
		if rows >= n {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("only %d/%d peer rows landed after %s", rows, n, budget)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Logf("%d rows landed in %s", n, time.Since(t0))
}

// TestPeerWriterFlushesOnCtxCancel verifies that the writer drains
// already-collected batch jobs on ctx cancellation with a fresh
// background context, so an in-flight burst at shutdown isn't silently
// dropped.
func TestPeerWriterFlushesOnCtxCancel(t *testing.T) {
	db := storage.MakeTestDB(t)
	ctx, cancel := context.WithCancel(context.Background())

	w := newPeerWriter(db, zap.NewNop())
	done := make(chan struct{})
	go func() { defer close(done); w.run(ctx) }()

	// Enqueue jobs while the writer is mid-coalesce. The Sleep gives
	// the writer time to receive the first job and arm its flush
	// timer, so the cancel below fires during the "fill" phase rather
	// than the "wait for first job" phase. We're specifically
	// exercising the ctx-cancel path INSIDE the inner fill loop.
	w.enqueue(peerWriteJob{pid: "12D3KooW_shutdown_test_a", addrs: "/ip4/127.0.0.1/tcp/49000/p2p/12D3KooW_shutdown_test_a"})
	time.Sleep(5 * time.Millisecond)
	w.enqueue(peerWriteJob{pid: "12D3KooW_shutdown_test_b", addrs: "/ip4/127.0.0.1/tcp/49001/p2p/12D3KooW_shutdown_test_b"})

	// Cancel while the writer is still inside the flushDelay window.
	cancel()

	// Wait for the writer to exit.
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("peerWriter did not exit within 2s of ctx cancel")
	}

	// Both pre-cancel rows must still have landed via the
	// shutdown-flush branch.
	rows, err := countPeers(context.Background(), db)
	require.NoError(t, err)
	require.GreaterOrEqual(t, rows, 2, "pre-cancel batch must be flushed on shutdown")
}

// countPeers reads the row count from the peers table. Uses
// context.Background()-ish ctx so it works after the test ctx has been
// cancelled (used by the shutdown test above).
func countPeers(ctx context.Context, db *sqlitex.Pool) (int, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	var n int
	err := db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, "SELECT COUNT(*) FROM peers;", func(stmt *sqlite.Stmt) error {
			n = stmt.ColumnInt(0)
			return nil
		})
	})
	return n, err
}
