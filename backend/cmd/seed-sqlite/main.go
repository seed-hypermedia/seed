package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/abiosoft/ishell/v2"

	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

func main() {
	flag.Parse()

	args := flag.Args()
	if len(args) > 1 {
		fmt.Fprintf(os.Stderr, "usage: seed-sqlite [database-path]\n")
		os.Exit(1)
	}

	var dbPath string
	if len(args) == 0 {
		dbPath = ":memory:"
	} else {
		dbPath = args[0]
	}

	// Convert to URI format
	uri := pathToURI(dbPath)
	if uri == "" {
		// Need to convert relative path to absolute
		absPath, err := filepath.Abs(dbPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		uri = "file:" + absPath
	}

	// Open the database with pool size 1 using storage.OpenSQLite
	pool, err := storage.OpenSQLite(uri, 0, 1)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error opening database: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := runREPL(context.Background(), pool); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
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

	conn, release, err := pool.Conn(ctx)
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
