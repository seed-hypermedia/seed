package sqlitex

import (
	"iter"
	"seed/backend/util/iterx"
	"seed/backend/util/sqlite"
)

// Query executes a query and returns an iterator over the results.
// The iterator is single-use.
// The returned check function must be called after the iteration to release the query resources and check for any remaining errors.
func Query(conn *sqlite.Conn, query string, args ...any) (iter.Seq[*sqlite.Stmt], *iterx.LazyError) {
	le := iterx.NewLazyError()

	it := func(yield func(stmt *sqlite.Stmt) bool) {
		stmt, err := conn.Prepare(query)
		if err != nil {
			le.Set(err)
			return
		}

		BindArgs(stmt, args...)

		for {
			hasRow, err := stmt.Step()
			if err != nil {
				le.Add(err)
				break
			}

			if !hasRow {
				break
			}

			if !yield(stmt) {
				break
			}
		}

		le.Add(stmt.Reset())
	}

	return it, le
}
