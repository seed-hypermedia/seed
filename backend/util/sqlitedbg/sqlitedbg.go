// Package sqlitedbg provides debugging facility for sqlite.
package sqlitedbg

import (
	"context"
	"encoding/base64"
	"io"
	"os"

	"github.com/jedib0t/go-pretty/v6/table"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Exec a query and print the results into w.
func Exec[T *sqlitex.Pool | *sqlite.Conn](db T, w io.Writer, query string, args ...any) {
	if w == nil {
		w = os.Stdout
	}

	var conn *sqlite.Conn

	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *sqlitex.Pool:
		c, release, err := v.Conn(context.Background())
		if err != nil {
			panic(err)
		}
		defer release()
		conn = c
	}

	tw := table.NewWriter()
	tw.SetOutputMirror(os.Stdout)
	tw.SetStyle(table.StyleLight)

	stmt, _, err := conn.PrepareTransient(query)
	if err != nil {
		panic(err)
	}

	header := make(table.Row, stmt.ColumnCount())
	for i := 0; i < len(header); i++ {
		header[i] = stmt.ColumnName(i)
	}
	tw.AppendHeader(header)

	sqlitex.BindArgs(stmt, args...)

	for {
		hasRow, err := stmt.Step()
		if err != nil {
			panic(err)
		}
		if !hasRow {
			break
		}

		row := make(table.Row, len(header))
		for n := 0; n < len(header); n++ {
			var txt string
			if stmt.ColumnType(n) == sqlite.SQLITE_BLOB {
				data := stmt.ColumnBytes(n)
				txt = base64.RawStdEncoding.EncodeToString(data)
			} else {
				txt = stmt.ColumnText(n)
			}
			row[n] = txt
		}
		tw.AppendRow(row)
	}

	if err := stmt.Finalize(); err != nil {
		panic(err)
	}

	tw.Render()
}

// ExecPool is the same as Exec but uses the connection pool.
func ExecPool(db *sqlitex.Pool, w io.Writer, query string) {
	conn, release, err := db.Conn(context.Background())
	if err != nil {
		panic(err)
	}
	defer release()
	Exec(conn, w, query)
}
