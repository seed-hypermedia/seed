package sqlitex

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"seed/backend/util/sqlite"
)

// ErrBeginImmediateTx is returned when an immediate transaction cannot be started.
var ErrBeginImmediateTx = errors.New("Failed to begin immediate transaction")

// WithTx executes fn within an immediate transaction, and commits
// or rolls back accordingly.
func WithTx(conn *sqlite.Conn, fn func() error) error {
	caller := tracker.normalizeCaller(resolveCaller())

	// Single-shot handoff from Pool.WithTx: load + clear the pool-acquire
	// wait time the wrapper stashed for this conn. Zero for bare-conn
	// callers (they never went through the pool). The load must happen
	// before the nested-fallback branch below — that branch hands off to
	// Save(conn), and a stale value would attribute the wait twice.
	poolWait := loadAndClearPoolWait(conn)

	// Not allowing nested transactions can often be error-prone.
	// It might indicate a design flaw in the code, but because this is a wrapper that invokes a callback function,
	// it's relatively safe to just fallback to a savepoint when we receive a nested transaction error.
	//
	// This behavior should not be abused. Check [Read] and [Write] functions for better alternatives.
	t0 := time.Now()
	if err := Exec(conn, "BEGIN IMMEDIATE TRANSACTION;", nil); err != nil {
		beginWait := time.Since(t0)
		// Nested-tx fallback is a separate path. SQLite returns this as a text
		// message (not a numeric code), so keep the string match here.
		// Save() instruments itself (records outcomeSavepoint for the nested
		// branch since autocommit is false here), so no manual recordTx.
		if strings.Contains(err.Error(), "transaction within a transaction") {
			// Re-stash the pool wait so the inner Save sees it. Nested
			// case is rare; the extra store/load is negligible.
			if poolWait > 0 {
				stashPoolWait(conn, poolWait)
			}
			releaseSave := Save(conn)
			fnerr := fn()
			releaseSave(&fnerr)
			return fnerr
		}

		// Distinguish real busy-timeout expiry from other BEGIN IMMEDIATE
		// failures (SQLITE_INTERRUPT from ctx cancel, etc). Only real busy
		// codes count as "writer-lock contention" — interrupts are usually a
		// caller giving up on its own ctx and have no lock holder to blame.
		switch sqlite.ErrCode(err) {
		case sqlite.SQLITE_BUSY, sqlite.SQLITE_BUSY_RECOVERY, sqlite.SQLITE_BUSY_SNAPSHOT:
			heldBy := tracker.snapshotActive()
			tracker.recordTx(caller, beginWait, beginWait, poolWait, outcomeBeginBusy, nil, heldBy)
		default:
			tracker.recordTx(caller, beginWait, beginWait, poolWait, outcomeBeginInterrupted, nil, nil)
		}
		return fmt.Errorf("%w; original error: %w", ErrBeginImmediateTx, err)
	}
	beginWait := time.Since(t0)
	t1 := time.Now()
	activeID := tracker.startActive(caller)
	defer tracker.endActive(activeID, caller)
	beginCapture(conn)

	if err := fn(); err != nil {
		stmts := endCapture(conn)
		if rberr := Exec(conn, "ROLLBACK", nil); rberr != nil {
			tracker.recordTx(caller, beginWait, time.Since(t1), poolWait, outcomeRollback, stmts, nil)
			return fmt.Errorf("ROLLBACK error: %v; original error: %w", rberr, err)
		}
		tracker.recordTx(caller, beginWait, time.Since(t1), poolWait, outcomeRollback, stmts, nil)
		return err
	}

	commitErr := Exec(conn, "COMMIT", nil)
	stmts := endCapture(conn)
	outcome := outcomeCommit
	if commitErr != nil {
		outcome = outcomeRollback
	}
	tracker.recordTx(caller, beginWait, time.Since(t1), poolWait, outcome, stmts, nil)
	return commitErr
}

// WithTx executes fn within an immediate transaction using a new connection from the pool.
func (p *Pool) WithTx(ctx context.Context, fn func(*sqlite.Conn) error) error {
	t0 := time.Now()
	conn, release, err := p.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()
	stashPoolWait(conn, time.Since(t0))

	return WithTx(conn, func() error { return fn(conn) })
}

// WithSave executes fn within a Savepoint.
func (p *Pool) WithSave(ctx context.Context, fn func(*sqlite.Conn) error) error {
	t0 := time.Now()
	conn, release, err := p.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()
	stashPoolWait(conn, time.Since(t0))

	releaseSave := Save(conn)
	fnerr := fn(conn)
	releaseSave(&fnerr)
	return fnerr
}

// WithSaveTempOnly is the Pool wrapper for SaveTempOnly. Same shape
// as WithSave but uses the TEMP-only Save variant — see SaveTempOnly
// for the contract. Use only when the body writes exclusively to TEMP
// tables (per-connection temp.* attached DB); never for main-DB
// writes, since the writer-slot tracker will under-report.
func (p *Pool) WithSaveTempOnly(ctx context.Context, fn func(*sqlite.Conn) error) error {
	t0 := time.Now()
	conn, release, err := p.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()
	stashPoolWait(conn, time.Since(t0))

	releaseSave := SaveTempOnly(conn)
	fnerr := fn(conn)
	releaseSave(&fnerr)
	return fnerr
}

// Read is a generic function for reading from the database.
// Currently this function can be used to write data too, but eventually it will only provide read-only connections.
func Read[DB *Pool | *sqlite.Conn, T any](ctx context.Context, db DB, fn func(*sqlite.Conn) (T, error)) (out T, err error) {
	var conn *sqlite.Conn
	switch db := any(db).(type) {
	case *sqlite.Conn:
		conn = db
	case *Pool:
		t0 := time.Now()
		c, release, err := db.Conn(ctx)
		if err != nil {
			return out, err
		}
		defer release()
		stashPoolWait(c, time.Since(t0))
		conn = c
	}

	defer Save(conn)(&err)

	return fn(conn)
}

// Write is a generic function for writing to the database.
func Write[DB *Pool | *sqlite.Conn, T any](ctx context.Context, db DB, fn func(*sqlite.Conn) (T, error)) (out T, err error) {
	var conn *sqlite.Conn
	switch db := any(db).(type) {
	case *sqlite.Conn:
		conn = db
	case *Pool:
		t0 := time.Now()
		c, release, err := db.Conn(ctx)
		if err != nil {
			return out, err
		}
		defer release()
		stashPoolWait(c, time.Since(t0))
		conn = c
	}

	if err := WithTx(conn, func() error {
		var err error
		out, err = fn(conn)
		return err
	}); err != nil {
		return out, err
	}

	return out, nil
}
