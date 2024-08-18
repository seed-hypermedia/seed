package sqlitex

import (
	"errors"
	"iter"
	"seed/backend/util/sqlite"
)

// Query executes a query and returns an iterator over the results.
// The iterator is single-use.
// The returned check function must be called after the iteration to release the query resources and check for any remaining errors.
func Query(conn *sqlite.Conn, query string, args ...any) (seq iter.Seq[*sqlite.Stmt], check func() error) {
	stmt, err := conn.Prepare(query)
	if err != nil {
		return nopSeq, wrapCheck(annotateErr(err))
	}

	BindArgs(stmt, args...)

	it := func(yield func(stmt *sqlite.Stmt) bool) {
		var hasRow bool // needed to assigned to the shadowed err variable.
		for {
			hasRow, err = stmt.Step()
			if err != nil {
				err = annotateErr(err)
				break
			}

			if !hasRow {
				break
			}

			if !yield(stmt) {
				break
			}
		}

		err = errors.Join(err, stmt.Reset())
	}

	return it, func() error { return err }
}

var nopSeq iter.Seq[*sqlite.Stmt] = func(func(*sqlite.Stmt) bool) {}

func wrapCheck(err error) func() error {
	return func() error {
		return err
	}
}
