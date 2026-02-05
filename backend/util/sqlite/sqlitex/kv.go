package sqlitex

import (
	"context"

	"seed/backend/util/sqlite"
)

// SetKV sets a key-value pair in the kv table.
func SetKV[T *sqlite.Conn | *Pool](ctx context.Context, db T, key, value string, replace bool) error {
	var conn *sqlite.Conn
	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *Pool:
		c, release, err := v.Conn(ctx)
		if err != nil {
			return err
		}
		defer release()
		conn = c
	}

	if replace {
		return Exec(conn, "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?);", nil, key, value)
	}

	return Exec(conn, "INSERT INTO kv (key, value) VALUES (?, ?);", nil, key, value)
}

// GetKV gets a value from the kv table.
func GetKV[T *sqlite.Conn | *Pool](ctx context.Context, db T, key string) (string, error) {
	var conn *sqlite.Conn
	switch v := any(db).(type) {
	case *sqlite.Conn:
		conn = v
	case *Pool:
		c, release, err := v.Conn(ctx)
		if err != nil {
			return "", err
		}
		defer release()
		conn = c
	}

	var value string
	err := Exec(conn, "SELECT value FROM kv WHERE key = ?;", func(stmt *sqlite.Stmt) error {
		value = stmt.ColumnText(0)
		return nil
	}, key)
	if err != nil {
		return "", err
	}

	return value, nil
}
