package sqlitex

import (
	"context"
	"errors"
	"fmt"

	"seed/backend/util/sqlite"
)

// ErrBeginImmediateTx is returned when an immediate transaction cannot be started.
var ErrBeginImmediateTx = errors.New("Failed to begin immediate transaction")

// WithTx executes fn within an immediate transaction, and commits
// or rolls back accordingly.
func WithTx(conn *sqlite.Conn, fn func() error) error {
	if err := Exec(conn, "BEGIN IMMEDIATE TRANSACTION;", nil); err != nil {
		return fmt.Errorf("%w; original error: %w", ErrBeginImmediateTx, err)
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
func (p *Pool) WithSave(ctx context.Context, fn func(*sqlite.Conn) error) (err error) {
	conn, release, err := p.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	defer Save(conn)(&err)

	return fn(conn)
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
