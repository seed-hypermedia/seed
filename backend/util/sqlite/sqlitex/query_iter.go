package sqlitex

import (
	"errors"
	"iter"
	"seed/backend/util/sqlite"
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
