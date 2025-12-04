package sqlite

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// Set up a custom logger to capture warnings.
var testHandler = &captureHandler{}

func init() {
	log = slog.New(testHandler)
}

func TestParseTransactionEvent(t *testing.T) {
	tests := []struct {
		name string
		sql  string
		want txEvent
	}{
		// Starts.
		{"begin immediate", "BEGIN IMMEDIATE", txStart},
		{"begin exclusive", "begin   exclusive   transaction", txStart},
		{"begin immediate newline", "  Begin\nImmediate  Transaction  ", txStart},
		{"begin uppercase mix", "BeGiN ImMeDiAtE", txStart},

		// Ignored begins.
		{"begin deferred", "BEGIN DEFERRED", noTxEvent},
		{"begin default no token", "BEGIN", noTxEvent},
		{"begin weird spacing", "   begin   ", noTxEvent},

		// Commits.
		{"commit", "COMMIT", txEnd},
		{"commit transaction", "commit   transaction", txEnd},
		{"end", "End", txEnd},

		// Rollback (real).
		{"rollback", "ROLLBACK", txEnd},
		{"rollback transaction", "rollback   transaction", txEnd},
		{"rollback mixed case", "RoLlBaCk", txEnd},

		// Rollback savepoint (ignored).
		{"rollback to savepoint", "ROLLBACK TO SAVEPOINT foo", noTxEvent},
		{"rollback tx to savepoint", "ROLLBACK TRANSACTION TO SAVEPOINT foo", noTxEvent},
		{"rollback to savepoint spaced", "rollback   to   savepoint   x", noTxEvent},
		{"rollback to savepoint newline", "rollback\nto savepoint x", noTxEvent},

		// Noise / others.
		{"unrelated", "SELECT * FROM users", noTxEvent},
		{"empty", "", noTxEvent},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseTransactionEvent(tt.sql)
			if got != tt.want {
				t.Fatalf("ParseTransaction(%q) = %v, want %v", tt.sql, got, tt.want)
			}
		})
	}
}

type captureHandler struct {
	logs []*slog.Record
	mu   sync.Mutex
}

func (h *captureHandler) Handle(ctx context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.logs = append(h.logs, &r)
	return nil
}

func (h *captureHandler) WithAttrs(attrs []slog.Attr) slog.Handler { return h }
func (h *captureHandler) WithGroup(name string) slog.Handler       { return h }
func (h *captureHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return true
}

func (h *captureHandler) GetLogs() []*slog.Record {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.logs
}

func TestTrackTransactionLogsOnlyWhenExceedingTimeout(t *testing.T) {
	// Create a temporary database for testing.
	dbFile := t.TempDir() + "/test.db"

	// Create two connections with a short busy timeout.
	conn1, err := OpenConn(dbFile)
	if err != nil {
		t.Fatalf("failed to open connection 1: %v", err)
	}
	defer conn1.Close()

	conn2, err := OpenConn(dbFile)
	if err != nil {
		t.Fatalf("failed to open connection 2: %v", err)
	}
	defer conn2.Close()

	// Set a very short busy timeout so we can control the timing.
	busyTimeout := 50 * time.Millisecond
	conn1.SetBusyTimeout(busyTimeout)
	conn2.SetBusyTimeout(busyTimeout)

	// Test scenario 1: Quick transaction that doesn't exceed timeout.
	t.Run("quick transaction", func(t *testing.T) {
		testHandler.logs = nil

		// Prepare a quick statement and transaction.
		stmt, err := conn1.Prepare("BEGIN IMMEDIATE")
		if err != nil {
			t.Fatalf("failed to prepare BEGIN IMMEDIATE: %v", err)
		}
		if _, err := stmt.Step(); err != nil {
			t.Fatalf("failed to step BEGIN IMMEDIATE: %v", err)
		}

		commitStmt, err := conn1.Prepare("COMMIT")
		if err != nil {
			t.Fatalf("failed to prepare COMMIT: %v", err)
		}
		if _, err := commitStmt.Step(); err != nil {
			t.Fatalf("failed to step COMMIT: %v", err)
		}

		// Check that no SlowQuery log was written (or it should be filtered).
		logs := testHandler.GetLogs()
		for _, log := range logs {
			if log.Message == "SlowQuery" {
				t.Errorf("unexpected SlowQuery log for quick transaction: %v", log)
			}
		}
	})

	// Test scenario 2: Long-running transaction that exceeds timeout.
	t.Run("slow transaction due to lock", func(t *testing.T) {
		testHandler.logs = nil

		// conn2 starts a transaction and holds a lock.
		stmt2, err := conn2.Prepare("BEGIN IMMEDIATE")
		if err != nil {
			t.Fatalf("failed to prepare BEGIN IMMEDIATE on conn2: %v", err)
		}
		if _, err := stmt2.Step(); err != nil {
			t.Fatalf("failed to step BEGIN IMMEDIATE on conn2: %v", err)
		}

		// conn1 tries to start a transaction while conn2 holds the lock.
		// This should take at least busyTimeout.
		start := time.Now()
		stmt1, err := conn1.Prepare("BEGIN IMMEDIATE")
		if err != nil {
			t.Fatalf("failed to prepare BEGIN IMMEDIATE on conn1: %v", err)
		}
		if _, err := stmt1.Step(); err != nil {
			// We expect this to fail with SQLITE_BUSY.
			if !strings.Contains(err.Error(), "database is locked") {
				t.Logf("expected locked error, got: %v", err)
			}
		}
		elapsed := time.Since(start)

		// Verify that we waited at least the busy timeout.
		if elapsed < busyTimeout {
			t.Logf("expected wait time >= %v, got %v", busyTimeout, elapsed)
		}

		// conn2 commits to release the lock.
		commitStmt2, err := conn2.Prepare("COMMIT")
		if err != nil {
			t.Fatalf("failed to prepare COMMIT on conn2: %v", err)
		}
		if _, err := commitStmt2.Step(); err != nil {
			t.Fatalf("failed to step COMMIT on conn2: %v", err)
		}

		// Now check if a SlowQuery log was written for conn2's transaction.
		logs := testHandler.GetLogs()
		found := false
		for _, log := range logs {
			if log.Message == "SlowQuery" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected SlowQuery log for transaction that exceeded busy timeout, but found none")
		}
	})
}

func TestTrackTransactionIntegration(t *testing.T) {
	// Create a temporary database for testing.
	dbFile := t.TempDir() + "/test.db"

	conn, err := OpenConn(dbFile)
	if err != nil {
		t.Fatalf("failed to open connection: %v", err)
	}
	defer conn.Close()

	// Set a very short busy timeout.
	busyTimeout := 10 * time.Millisecond
	conn.SetBusyTimeout(busyTimeout)

	// Capture logs.
	handler := &captureHandler{}
	SetLogger(slog.New(handler))

	// Create a simple table.
	stmt, err := conn.Prepare("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)")
	if err != nil {
		t.Fatalf("failed to prepare CREATE TABLE: %v", err)
	}
	if _, err := stmt.Step(); err != nil {
		t.Fatalf("failed to step CREATE TABLE: %v", err)
	}
	if err := stmt.Finalize(); err != nil {
		t.Fatalf("failed to finalize CREATE TABLE: %v", err)
	}

	// Test: Start and commit a transaction.
	handler.logs = nil
	stmt, err = conn.Prepare("BEGIN IMMEDIATE")
	if err != nil {
		t.Fatalf("failed to prepare BEGIN IMMEDIATE: %v", err)
	}
	if _, err := stmt.Step(); err != nil {
		t.Fatalf("failed to step BEGIN IMMEDIATE: %v", err)
	}
	if err := stmt.Finalize(); err != nil {
		t.Fatalf("failed to finalize BEGIN IMMEDIATE: %v", err)
	}

	// Sleep to simulate work (this will affect transaction duration).
	time.Sleep(busyTimeout * 2)

	stmt, err = conn.Prepare("COMMIT")
	if err != nil {
		t.Fatalf("failed to prepare COMMIT: %v", err)
	}
	if _, err := stmt.Step(); err != nil {
		t.Fatalf("failed to step COMMIT: %v", err)
	}
	if err := stmt.Finalize(); err != nil {
		t.Fatalf("failed to finalize COMMIT: %v", err)
	}

	// Verify that a log was written.
	logs := handler.GetLogs()
	found := false
	for _, log := range logs {
		if log.Message == "SlowQuery" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected SlowQuery log, but found none")
	}
}
