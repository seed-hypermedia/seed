package sqlitex

import (
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"strings"
	"time"

	"seed/backend/util/sqlite"
)

// ErrBeginImmediateTx is returned when an immediate transaction cannot be started.
var ErrBeginImmediateTx = errors.New("Failed to begin immediate transaction")

// WithTx executes fn within an immediate transaction, and commits
// or rolls back accordingly.
func WithTx(conn *sqlite.Conn, fn func() error) error {
	start := time.Now()
	defer func() {
		d := time.Since(start)
		if d >= conn.BusyTimeout() {
			log.Warn("SlowQuery",
				"duration", d.String(),
				"stacktrace", string(debug.Stack()),
			)
		}
	}()

	// Not allowing nested transactions can often be error-prone.
	// It might indicate a design flaw in the code, but because this is a wrapper that invokes a callback function,
	// it's relatively safe to just fallback to a savepoint when we receive a nested transaction error.
	//
	// This behavior should not be abused. Check [Read] and [Write] functions for better alternatives.
	if err := Exec(conn, "BEGIN IMMEDIATE TRANSACTION;", nil); err != nil {
		// We want to return any errors that are not about the nested transaction.
		if !strings.Contains(err.Error(), "transaction within a transaction") {
			return fmt.Errorf("%w; original error: %w", ErrBeginImmediateTx, err)
		}

		releaseSave := Save(conn)
		fnerr := fn()
		releaseSave(&fnerr)
		return fnerr
	}

	if err := fn(); err != nil {
		if rberr := Exec(conn, "ROLLBACK", nil); rberr != nil {
			return fmt.Errorf("ROLLBACK error: %v; original error: %w", rberr, err)
		}
		return err
	}

	return Exec(conn, "COMMIT", nil)
}

// WithTx executes fn within an immediate transaction using a new connection from the pool.
func (p *Pool) WithTx(ctx context.Context, fn func(*sqlite.Conn) error) error {
	conn, release, err := p.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	return WithTx(conn, func() error { return fn(conn) })
}

// WithSave executes fn within a Savepoint.
func (p *Pool) WithSave(ctx context.Context, fn func(*sqlite.Conn) error) error {
	conn, release, err := p.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	releaseSave := Save(conn)
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
		c, release, err := db.Conn(ctx)
		if err != nil {
			return out, err
		}
		defer release()
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
		c, release, err := db.Conn(ctx)
		if err != nil {
			return out, err
		}
		defer release()
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
