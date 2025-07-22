package sqlitex

import (
	"context"
	"errors"
	"iter"
	"seed/backend/util/sqlite"

	"golang.org/x/exp/constraints"
)

// Query executes a query and returns an iterator over the results.
// The iterator is single-use.
// The returned check function must be called after the iteration to release the query resources and check for any remaining errors.
func Query(conn *sqlite.Conn, query string, args ...any) (it iter.Seq[*sqlite.Stmt], check func() error) {
	var outErr error
	check = func() error { return outErr }
	it = func(yield func(stmt *sqlite.Stmt) bool) {
		stmt, err := conn.Prepare(query)
		if err != nil {
			outErr = err
			return
		}

		BindArgs(stmt, args...)

		for {
			hasRow, err := stmt.Step()
			if err != nil {
				outErr = errors.Join(outErr, err)
				break
			}

			if !hasRow {
				break
			}

			if !yield(stmt) {
				break
			}
		}

		outErr = errors.Join(outErr, stmt.Reset())
	}

	return it, check
}

// Result is a type constraint for query results.
type Result interface {
	~string | constraints.Integer | constraints.Float
}

// QueryOne executes a query and returns a single result.
func QueryOne[T Result](conn *sqlite.Conn, query string, args ...any) (resp T, err error) {
	err = errNoResults
	rows, check := Query(conn, query, args...)
	for row := range rows {
		row.Scan(&resp)
		err = nil
		break
	}
	if err := check(); err != nil {
		return resp, err
	}
	return resp, err
}

// QueryOnePool is like [QueryOne] but uses the connection pool.
func QueryOnePool[T Result](ctx context.Context, db *Pool, query string, args ...any) (resp T, err error) {
	conn, release, err := db.Conn(ctx)
	if err != nil {
		return resp, err
	}
	defer release()

	return QueryOne[T](conn, query, args...)
}
