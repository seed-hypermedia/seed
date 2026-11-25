package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/abiosoft/ishell/v2"
	"github.com/peterbourgon/ff/v4"

	"seed/backend/config"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

const sqlLongHelp = `Opens an interactive SQL shell with all of our custom SQLite extensions loaded, for quick testing and prototyping. It's much more limited than the official sqlite3 shell.

Without arguments it opens an in-memory database. If the data directory is given explicitly (with -data-dir, SEED_DATA_DIR, or SEED_DAEMON_FLAGS), it opens the daemon database in that directory. A DATABASE argument opens that file instead, and ":memory:" opens an in-memory database.

It doesn't run migrations or check the schema, and it executes every statement as typed, writes included. Be careful with the database of a running daemon.

Type .tables to list the tables, and .quit to exit.`

// newSQLCmd creates the sql subcommand. It inherits the daemon flags from parent,
// and opens the data directory from cfg only if it was set explicitly.
func newSQLCmd(cfg *config.Config, parent *ff.FlagSet) *ff.Command {
	dataDirFlag, ok := parent.GetFlag("data-dir")
	if !ok {
		panic("BUG: daemon flags must define -data-dir")
	}

	// Standard flag package for single-dash flags, like the daemon ones.
	stdfs := flag.NewFlagSet("sql", flag.ContinueOnError)

	return &ff.Command{
		Name:      "sql",
		Usage:     "seed-daemon sql [FLAGS] [DATABASE]",
		ShortHelp: "Open an interactive SQL shell with our custom SQLite extensions.",
		LongHelp:  sqlLongHelp,
		Flags:     ff.NewFlagSetFrom(stdfs.Name(), stdfs).SetParent(parent),
		Exec: func(_ context.Context, args []string) error {
			dbPath, err := sqlDatabasePath(args, cfg.Base, dataDirFlag.IsSet())
			if err != nil {
				return err
			}

			return runSQL(dbPath)
		},
	}
}

// sqlDatabasePath decides which database the sql subcommand opens.
func sqlDatabasePath(args []string, base config.Base, dataDirSet bool) (string, error) {
	switch {
	case len(args) > 1:
		return "", fmt.Errorf("sql: expected at most one DATABASE argument, got %q", args)
	case len(args) == 1 && dataDirSet:
		return "", errors.New("sql: give either a DATABASE argument or a data directory, not both")
	case len(args) == 1:
		return args[0], nil
	case dataDirSet:
		if err := base.ExpandDataDir(); err != nil {
			return "", err
		}

		// Opening a missing file would silently create an empty database.
		dbPath := storage.SQLitePath(base.DataDir)
		if _, err := os.Stat(dbPath); err != nil {
			return "", fmt.Errorf("sql: no database in data directory %q: %w", base.DataDir, err)
		}

		return dbPath, nil
	default:
		return ":memory:", nil
	}
}

// runSQL opens the database and runs the interactive shell until the user quits.
func runSQL(dbPath string) error {
	uri := pathToURI(dbPath)
	if uri == "" {
		absPath, err := filepath.Abs(dbPath)
		if err != nil {
			return err
		}

		uri = "file:" + absPath
	}

	pool, err := storage.OpenSQLite(uri, 0, 1)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}
	defer pool.Close()

	return runREPL(context.Background(), pool)
}

func runREPL(ctx context.Context, pool *sqlitex.Pool) error {
	shell := ishell.New()
	shell.SetPrompt("> ")

	// Override the default behavior to handle raw SQL input
	shell.NotFound(func(c *ishell.Context) {
		input := strings.Join(c.RawArgs, " ")
		trimmed := strings.TrimSpace(input)

		if trimmed == "" {
			return
		}

		// Check for dot commands
		if strings.HasPrefix(trimmed, ".") {
			if trimmed == ".quit" {
				c.Stop()
				return
			}
			if trimmed == ".tables" {
				if err := executeQuery(ctx, pool, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"); err != nil {
					c.Println("error:", err)
				}
				return
			}
			c.Println("error: unknown command:", trimmed)
			return
		}

		// If input doesn't end with semicolon, read more lines
		fullQuery := input
		if !strings.HasSuffix(trimmed, ";") {
			c.ShowPrompt(false)
			defer c.ShowPrompt(true)
			moreLines := c.ReadMultiLines(";")
			c.ShowPrompt(true)
			fullQuery = input + "\n" + moreLines
		}

		// Execute as SQL query
		query := strings.TrimSuffix(strings.TrimSpace(fullQuery), ";")
		if err := executeQuery(ctx, pool, query); err != nil {
			c.Println("error:", err)
		}
	})

	shell.Run()
	return nil
}

func executeQuery(ctx context.Context, pool *sqlitex.Pool, query string) error {
	if strings.TrimSpace(query) == "" {
		return nil
	}

	conn, release, err := pool.WriteConn(ctx)
	if err != nil {
		return err
	}
	defer release()

	// Prepare the statement
	stmt, _, err := conn.PrepareTransient(query)
	if err != nil {
		return err
	}
	defer stmt.Finalize()

	// Get column count and names
	colCount := stmt.ColumnCount()
	if colCount == 0 {
		// Not a SELECT query, just execute
		_, err := stmt.Step()
		if err != nil && err.Error() != "SQLITE_DONE" {
			return err
		}

		// Print rows/columns affected
		changes := conn.Changes()
		if changes > 0 {
			fmt.Printf("(%d row(s) affected)\n", changes)
		}
		return nil
	}

	// Get column names
	colNames := make([]string, colCount)
	for i := 0; i < colCount; i++ {
		colNames[i] = stmt.ColumnName(i)
	}

	// Collect rows to determine column widths
	var rows [][]string
	for {
		// Check if context was cancelled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		hasRow, err := stmt.Step()
		if err != nil {
			return err
		}
		if !hasRow {
			break
		}

		row := make([]string, colCount)
		for i := 0; i < colCount; i++ {
			row[i] = columnToString(stmt, i)
		}
		rows = append(rows, row)
	}

	// Calculate column widths
	colWidths := make([]int, colCount)
	for i, name := range colNames {
		colWidths[i] = len(name)
	}
	for _, row := range rows {
		for i, val := range row {
			if len(val) > colWidths[i] {
				colWidths[i] = len(val)
			}
		}
	}

	// Print rows
	for _, row := range rows {
		for i, val := range row {
			fmt.Print(val)
			if i < len(row)-1 {
				fmt.Print(strings.Repeat(" ", colWidths[i]-len(val)+2))
			}
		}
		fmt.Println()
	}

	// Print separator
	totalWidth := 0
	for i, w := range colWidths {
		totalWidth += w
		if i < len(colWidths)-1 {
			totalWidth += 2
		}
	}
	fmt.Println(strings.Repeat("─", totalWidth))

	// Print footer with column names (Nushell style)
	for i, name := range colNames {
		fmt.Print(name)
		if i < len(colNames)-1 {
			fmt.Print(strings.Repeat(" ", colWidths[i]-len(name)+2))
		}
	}
	fmt.Println()

	return nil
}

func columnToString(stmt *sqlite.Stmt, col int) string {
	switch stmt.ColumnType(col) {
	case sqlite.SQLITE_NULL:
		return "NULL"
	case sqlite.SQLITE_INTEGER:
		return fmt.Sprintf("%d", stmt.ColumnInt64(col))
	case sqlite.SQLITE_FLOAT:
		return fmt.Sprintf("%g", stmt.ColumnFloat(col))
	case sqlite.SQLITE_TEXT:
		return stmt.ColumnText(col)
	case sqlite.SQLITE_BLOB:
		return fmt.Sprintf("[%d bytes]", stmt.ColumnLen(col))
	default:
		return "?"
	}
}

func pathToURI(path string) string {
	// Use in-memory database if path is ":memory:" or empty.
	if path == "" || path == ":memory:" {
		return "file::memory:?mode=memory"
	}

	// Return empty string for regular paths (will be handled as absolute path).
	return ""
}
