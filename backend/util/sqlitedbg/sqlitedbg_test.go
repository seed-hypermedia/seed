package sqlitedbg_test

import (
	"os"
	"seed/backend/util/sqlitedbg"

	"seed/backend/util/sqlite"
)

func ExampleExec() {
	conn, err := sqlite.OpenConn("file:mem?mode=memory", sqlite.OpenFlagsDefault)
	if err != nil {
		panic(err)
	}
	defer conn.Close()

	sqlitedbg.Exec(conn, os.Stdout, "CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT)")
	sqlitedbg.Exec(conn, os.Stdout, "INSERT INTO foo VALUES (1, 'hello') RETURNING id")
	sqlitedbg.Exec(conn, os.Stdout, "SELECT * FROM foo")

	// Output:
	// ┌────┐
	// │ ID │
	// ├────┤
	// │ 1  │
	// └────┘
	// ┌────┬───────┐
	// │ ID │ NAME  │
	// ├────┼───────┤
	// │ 1  │ hello │
	// └────┴───────┘
}
