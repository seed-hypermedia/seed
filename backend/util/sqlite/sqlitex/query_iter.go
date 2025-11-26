package sqlitex

import (
	"context"
	"errors"
	"seed/backend/util/sqlite"

	"github.com/burdiyan/go-erriter"
	"golang.org/x/exp/constraints"
)

// Query executes a query and returns an iterator over the results.
// The iterator is single-use.
//
// See the comments on [erriter.Seq] for more info on how to use it.
func Query(conn *sqlite.Conn, query string, args ...any) erriter.Seq[*sqlite.Stmt] {
	return erriter.Make(func(yield func(stmt *sqlite.Stmt) bool) (err error) {
		stmt, err := conn.Prepare(query)
		if err != nil {
			return err
		}
		defer func() {
			err = errors.Join(err, stmt.Reset())
		}()

		BindArgs(stmt, args...)

		for {
			hasRow, err := stmt.Step()
			if err != nil {
				return err
			}

			if !hasRow {
				return err
			}

			if !yield(stmt) {
				return err
			}
		}
	})
}

// MapperFunc is a function type that converts a row into a value of type T.
type MapperFunc[T any] func(*sqlite.Stmt) (T, error)

// QueryType is like [Query] but transforms raw DB values into concrete types using the provided mapper function.
func QueryType[T any](conn *sqlite.Conn, mapper MapperFunc[T], query string, args ...any) erriter.Seq[T] {
	return erriter.Make(func(yield func(T) bool) (err error) {
		rows, discard, check := Query(conn, query, args...).All()
		defer discard(&err)

		for row := range rows {
			v, err := mapper(row)
			if err != nil {
				return err
			}

			if !yield(v) {
				return err
			}
		}

		return check()
	})
}

// Result is a type constraint for query results.
type Result interface {
	~string | constraints.Integer | constraints.Float
}

// QueryOne executes a query and returns a single result.
func QueryOne[T Result](conn *sqlite.Conn, query string, args ...any) (resp T, err error) {
	err = errNoResults
	rows, discard, check := Query(conn, query, args...).All()
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
