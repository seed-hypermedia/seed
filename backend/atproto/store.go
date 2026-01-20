package atproto

import (
	"context"
	"encoding/json"
	"fmt"
	"seed/backend/util/sqlite/sqlitex"
	"time"
)

// SQLiteStore is a SQLite-backed connection store.
type SQLiteStore struct {
	pool *sqlitex.Pool
}

// NewSQLiteStore creates a new SQLite-backed store.
func NewSQLiteStore(pool *sqlitex.Pool) *SQLiteStore {
	return &SQLiteStore{pool: pool}
}

// InitSchema initializes the schema for AT Protocol connections.
// This should be called during database initialization.
func InitSchema(conn *sqlitex.Conn) error {
	return sqlitex.ExecScript(conn, `
		CREATE TABLE IF NOT EXISTS atproto_connections (
			seed_account TEXT PRIMARY KEY NOT NULL,
			did TEXT NOT NULL,
			handle TEXT NOT NULL,
			pds_url TEXT NOT NULL,
			access_jwt TEXT NOT NULL,
			refresh_jwt TEXT NOT NULL,
			connect_time INTEGER NOT NULL,
			extra_data TEXT
		);

		CREATE INDEX IF NOT EXISTS idx_atproto_connections_did ON atproto_connections(did);
	`)
}

func (s *SQLiteStore) Save(ctx context.Context, conn *Connection) error {
	dbConn, release, err := s.pool.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection: %w", err)
	}
	defer release()

	return sqlitex.Exec(dbConn, `
		INSERT OR REPLACE INTO atproto_connections (
			seed_account, did, handle, pds_url, access_jwt, refresh_jwt, connect_time
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`, nil,
		conn.SeedAccount,
		conn.DID,
		conn.Handle,
		conn.PDSURL,
		conn.AccessJwt,
		conn.RefreshJwt,
		conn.ConnectTime.Unix(),
	)
}

func (s *SQLiteStore) Load(ctx context.Context, seedAccount string) (*Connection, error) {
	dbConn, release, err := s.pool.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("get connection: %w", err)
	}
	defer release()

	var conn *Connection
	err = sqlitex.Exec(dbConn, `
		SELECT seed_account, did, handle, pds_url, access_jwt, refresh_jwt, connect_time
		FROM atproto_connections
		WHERE seed_account = ?
	`, func(stmt *sqlitex.Stmt) error {
		conn = &Connection{
			SeedAccount: stmt.ColumnText(0),
			DID:         stmt.ColumnText(1),
			Handle:      stmt.ColumnText(2),
			PDSURL:      stmt.ColumnText(3),
			AccessJwt:   stmt.ColumnText(4),
			RefreshJwt:  stmt.ColumnText(5),
			ConnectTime: time.Unix(stmt.ColumnInt64(6), 0),
		}
		return nil
	}, seedAccount)

	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}

	return conn, nil
}

func (s *SQLiteStore) Delete(ctx context.Context, seedAccount string) error {
	dbConn, release, err := s.pool.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection: %w", err)
	}
	defer release()

	return sqlitex.Exec(dbConn, `
		DELETE FROM atproto_connections WHERE seed_account = ?
	`, nil, seedAccount)
}

func (s *SQLiteStore) List(ctx context.Context) ([]*Connection, error) {
	dbConn, release, err := s.pool.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("get connection: %w", err)
	}
	defer release()

	var connections []*Connection
	err = sqlitex.Exec(dbConn, `
		SELECT seed_account, did, handle, pds_url, access_jwt, refresh_jwt, connect_time
		FROM atproto_connections
		ORDER BY connect_time DESC
	`, func(stmt *sqlitex.Stmt) error {
		connections = append(connections, &Connection{
			SeedAccount: stmt.ColumnText(0),
			DID:         stmt.ColumnText(1),
			Handle:      stmt.ColumnText(2),
			PDSURL:      stmt.ColumnText(3),
			AccessJwt:   stmt.ColumnText(4),
			RefreshJwt:  stmt.ColumnText(5),
			ConnectTime: time.Unix(stmt.ColumnInt64(6), 0),
		})
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}

	return connections, nil
}

// Verify interface compliance.
var _ ConnectionStore = (*SQLiteStore)(nil)

// Unused but kept for potential serialization needs.
var _ = json.Marshal
