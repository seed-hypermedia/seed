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
// The returned discard function must be called as a defer right after Query returns, having a pointer to an error value
// where the error is going to be added if any.
// This is to make sure we check for errors if we return from the iterator loop without getting to the check() call.
//
// For example:
//
//	rows, discard, check := sqlitex.Query(conn, "...")
//	defer discard(&err)
//
//	for row := range rows {
//		if err := doSomething(row); err != nil {
//			return err
//		}
//	}
//
//	if err := check(); err != nil {
//		return err
//	}
func Query(conn *sqlite.Conn, query string, args ...any) (it iter.Seq[*sqlite.Stmt], discard func(*error), check func() error) {
	var (
		err         error
		checkCalled bool
	)

	discard = func(errp *error) {
		if checkCalled {
			return
		}
		*errp = errors.Join(*errp, err)
	}

	check = func() error {
		if checkCalled {
			panic("BUG: check called twice")
		}
		checkCalled = true
		return err
	}

	it = func(yield func(stmt *sqlite.Stmt) bool) {
		var stmt *sqlite.Stmt
		stmt, err = conn.Prepare(query)
		if err != nil {
			return
		}
		defer func() {
			err = errors.Join(err, stmt.Reset())
		}()

		BindArgs(stmt, args...)

		for {
			var hasRow bool
			hasRow, err = stmt.Step()
			if err != nil {
				return
			}

			if !hasRow {
				return
			}

			if !yield(stmt) {
				return
			}
		}
	}

	return it, discard, check
}

// QueryType is like [Query] but lets you have concrete types in the iterator instead of the generic rows.
func QueryType[T any](conn *sqlite.Conn, mapper func(*sqlite.Stmt) T, query string, args ...any) (it iter.Seq[T], discard func(*error), check func() error) {
	rows, discard, check := Query(conn, query, args...)
	it = func(yield func(T) bool) {
		for row := range rows {
			if !yield(mapper(row)) {
				break
			}
		}
	}
	return it, discard, check
}

// Result is a type constraint for query results.
type Result interface {
	~string | constraints.Integer | constraints.Float
}

// QueryOne executes a query and returns a single result.
func QueryOne[T Result](conn *sqlite.Conn, query string, args ...any) (resp T, err error) {
	err = errNoResults
	rows, discard, check := Query(conn, query, args...)
	defer discard(&err)
	for row := range rows {
		row.Scan(&resp)
		err = nil
		break
	}
	err = errors.Join(err, check())
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
