package keylinesqlite_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"seed/backend/blob/keylinesqlite"
	"seed/backend/keyline"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Authorize and perform a protected write in one application transaction.
// Facts applied through Tx are visible to later queries before commit, and
// they commit or roll back together with the application's own writes. Each
// fact cites a stored blob.
func ExampleTx() {
	ctx := context.Background()

	dir, err := os.MkdirTemp("", "keyline-example")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(dir)

	pool, err := storage.OpenSQLite(filepath.Join(dir, "app.db"), 0, 1)
	if err != nil {
		panic(err)
	}
	defer pool.Close()

	if err := storage.InitSQLiteSchema(pool); err != nil {
		panic(err)
	}

	err = pool.WithTx(ctx, func(conn *sqlite.Conn) error {
		// Stand-ins for the capability blobs that carry these grants.
		if err := sqlitex.ExecScript(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (1, x'01', 85, 0), (2, x'02', 85, 0);`); err != nil {
			return err
		}

		tx := keylinesqlite.Tx{Conn: conn}
		if _, err := tx.Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{
			{ID: "notes-owner", Issuer: "notes", Audience: "alice", Subject: "notes", Power: keyline.Admin, BlobID: 1},
			{ID: "notes-bob", Issuer: "alice", Audience: "bob", Subject: "notes", Power: keyline.Write, BlobID: 2},
		}}); err != nil {
			return err
		}

		allowed, err := keyline.Allows(ctx, tx, "notes", "bob", keyline.Write)
		if err != nil {
			return err
		}

		fmt.Println(allowed)
		// Perform the protected application write here, on the same conn.
		return nil
	})
	if err != nil {
		panic(err)
	}

	// Output:
	// true
}
