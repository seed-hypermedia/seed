package keylinesqlite_test

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"testing/synctest"

	"seed/backend/keyline"
	"seed/backend/keyline/keylinesqlite"
	"seed/backend/keyline/keylinetest"
	"seed/backend/keyline/keylinetest/conformance"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

func TestSQLitePersistence(t *testing.T) {
	ctx := t.Context()
	path := filepath.Join(t.TempDir(), "keyline.db")
	batch := keyline.Batch{
		Nodes: []keyline.NodeRecord{{"same-id", math.MaxInt64, math.MinInt64, "same-blob"}, {"\x00", 7, 0, "\x00"}, {"\xff\xfe", 8, -1, "\xff\xfe"}, {"prefix\x00tail", 9, math.MaxInt64, "prefix\x00tail"}},
		Delegations: []keyline.Delegation{
			{"same-id", "missing issuer", "missing audience", "missing subject", keyline.Write, 7},
			{"\xff\x00", "\x00", "\xff\xfe", "prefix\x00tail", keyline.Read, 10},
		},
		Revocations: []keyline.Revocation{{"r", "missing revoker", "missing target", 9}, {"\xfe\x00", "\xff\xfe", "\xff\x00", 11}},
	}
	for pass := range 2 {
		db, err := sqlitex.Open(path, 0, 2)
		require.NoError(t, err)
		func() {
			defer func() { require.NoError(t, db.Close()) }()
			require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
				return keylinesqlite.Init(ctx, conn)
			}))

			store := keylinesqlite.Store{Pool: db}
			if pass == 0 {
				changed, err := store.Apply(ctx, batch)
				require.NoError(t, err)
				require.True(t, changed)
			}

			changed, err := store.Apply(ctx, batch)
			require.NoError(t, err)
			require.False(t, changed, "replay across reopen")
			// Check every lookup and index after reopen, including opaque bytes.
			// References never create records; NULs never truncate identifiers.
			keylinetest.RequireState(t, store, batch, keyline.Batch{Nodes: []keyline.NodeRecord{{ID: "missing subject"}, {ID: "prefix"}, {ID: "\xff"}}})
		}()
	}
}

func TestSQLiteNestedBatchRollback(t *testing.T) {
	ctx := t.Context()
	store := newSQLiteTestStore(t, keyline.Batch{})
	require.NoError(t, store.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
		tx := keylinesqlite.Tx{Conn: conn}
		changed, err := tx.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"before", 1, 0, "before-blob"}}})
		require.NoError(t, err)
		require.True(t, changed)
		changed, err = tx.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"lost", 2, 0, "lost-blob"}, {"before", 3, 0, "before-blob"}}})
		require.ErrorIs(t, err, keyline.ErrConflict)
		require.False(t, changed)
		require.False(t, conn.GetAutocommit())
		_, found, err := tx.Node(ctx, "lost")
		require.NoError(t, err)
		require.False(t, found)
		n, found, err := tx.Node(ctx, "before")
		require.NoError(t, err)
		require.True(t, found)
		require.EqualValues(t, 1, n.BlobID)
		_, err = tx.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"after", 4, 0, "after-blob"}}})
		return err
	}))
	keylinetest.RequireState(t, store, keyline.Batch{Nodes: []keyline.NodeRecord{{"before", 1, 0, "before-blob"}, {"after", 4, 0, "after-blob"}}}, keyline.Batch{Nodes: []keyline.NodeRecord{{ID: "lost"}}})
}

func TestSQLiteSchema(t *testing.T) {
	for _, mode := range []string{"idempotent", "unversioned", "legacy facts", "missing index", "changed index", "changed table", "caller rollback"} {
		t.Run(mode, func(t *testing.T) {
			ctx := t.Context()
			conn, err := sqlite.OpenConn(filepath.Join(t.TempDir(), "schema.db"), 0)
			require.NoError(t, err)
			defer func() { require.NoError(t, conn.Close()) }()
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE TABLE application_data (value TEXT)`)(), nil))
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`INSERT INTO application_data VALUES ('untouched')`)(), nil))

			switch mode {
			case "unversioned":
				require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE TABLE keyline_nodes (id TEXT)`)(), nil))
				require.Error(t, keylinesqlite.Init(ctx, conn))
			case "legacy facts":
				require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE TABLE keyline_facts (id TEXT)`)(), nil))
				require.Error(t, keylinesqlite.Init(ctx, conn))
			case "caller rollback":
				rollback := errors.New("rollback")
				err := sqlitex.WithTx(conn, func() error {
					require.NoError(t, keylinesqlite.Init(ctx, conn))
					return rollback
				})
				require.ErrorIs(t, err, rollback)
				n, err := sqlitex.QueryOne[int64](conn, dqb.Str(`SELECT count(*) FROM sqlite_schema WHERE name GLOB 'keyline_*'`)())
				require.NoError(t, err)
				require.Zero(t, n)
			default:
				require.NoError(t, keylinesqlite.Init(ctx, conn))
				switch mode {
				case "changed table":
					require.NoError(t, sqlitex.Exec(conn, dqb.Str(`ALTER TABLE keyline_delegations ADD COLUMN unexpected TEXT`)(), nil))
				case "missing index", "changed index":
					require.NoError(t, sqlitex.Exec(conn, dqb.Str(`DROP INDEX keyline_outgoing`)(), nil))

					if mode == "changed index" {
						require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE INDEX keyline_outgoing ON keyline_delegations(issuer)`)(), nil))
					}
				}

				if mode == "idempotent" {
					require.NoError(t, keylinesqlite.Init(ctx, conn))
				} else {
					require.Error(t, keylinesqlite.Init(ctx, conn))
				}
			}

			value, err := sqlitex.QueryOne[string](conn, dqb.Str(`SELECT value FROM application_data`)())
			require.NoError(t, err)
			require.Equal(t, "untouched", value)
		})
	}
}

func TestSQLiteApplicationSchemaObjects(t *testing.T) {
	for _, mode := range []string{"before init", "after init"} {
		t.Run(mode, func(t *testing.T) {
			ctx := t.Context()
			conn, err := sqlite.OpenConn(filepath.Join(t.TempDir(), "schema.db"), 0)
			require.NoError(t, err)
			defer func() { require.NoError(t, conn.Close()) }()

			if mode == "after init" {
				require.NoError(t, keylinesqlite.Init(ctx, conn))
			}

			// The application owns this cache's shape and contents, even when
			// it shares the store's prefix. Init must not depend on either.
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE TABLE keyline_members (member TEXT, value TEXT)`)(), nil))
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE INDEX keyline_members_by_member ON keyline_members (member)`)(), nil))
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE VIEW keyline_application_view AS SELECT value FROM keyline_members`)(), nil))
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`INSERT INTO keyline_members VALUES ('alice', 'untouched')`)(), nil))
			require.NoError(t, keylinesqlite.Init(ctx, conn))
			require.NoError(t, keylinesqlite.Init(ctx, conn))
			value, err := sqlitex.QueryOne[string](conn, dqb.Str(`SELECT value FROM keyline_application_view`)())
			require.NoError(t, err)
			require.Equal(t, "untouched", value)
			index, err := sqlitex.QueryOne[string](conn, dqb.Str(`SELECT sql FROM sqlite_schema WHERE name = 'keyline_members_by_member'`)())
			require.NoError(t, err)
			require.Equal(t, "CREATE INDEX keyline_members_by_member ON keyline_members (member)", index)
		})
	}
}

func TestSQLiteCorruptRowsFailClosed(t *testing.T) {
	for _, query := range []dqb.LazyQuery{
		dqb.Str(`UPDATE keyline_delegations SET power = 257 WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET power = '' WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET power = 'e' WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET power = 'R' WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET power = 'read' WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET power = ' r' WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET power = 'r ' WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET power = 'r' || char(0) WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET issuer = 999 WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET audience = 999 WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET subject = 999 WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_delegations SET blob_id = -1 WHERE id = 'd'`),
		dqb.Str(`UPDATE keyline_revocations SET issuer = 999 WHERE id = 'r'`),
		dqb.Str(`UPDATE keyline_revocations SET target = '' WHERE id = 'r'`),
		dqb.Str(`UPDATE keyline_revocations SET blob_id = 0 WHERE id = 'r'`),
		dqb.Str(`UPDATE keyline_nodes SET blob_id = 0 WHERE name = 'n'`),
	} {
		t.Run(query(), func(t *testing.T) {
			ctx := t.Context()
			store := newSQLiteTestStore(t, keyline.Batch{
				Delegations: []keyline.Delegation{{"d", "doc", "alice", "doc", keyline.Read, 1}},
				Revocations: []keyline.Revocation{{"r", "alice", "d", 2}},
			})
			_, err := store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"n", 3, 0, "n-blob"}}})
			require.NoError(t, err)
			require.NoError(t, store.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
				require.NoError(t, sqlitex.Exec(conn, dqb.Str(`PRAGMA ignore_check_constraints = ON`)(), nil))
				defer func() {
					require.NoError(t, sqlitex.Exec(conn, dqb.Str(`PRAGMA ignore_check_constraints = OFF`)(), nil))
				}()
				return sqlitex.Exec(conn, query(), nil)
			}))
			require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
				switch {
				case strings.Contains(query(), "keyline_nodes"):
					n, found, err := tx.Node(ctx, "n")
					require.Error(t, err)
					require.False(t, found)
					require.Zero(t, n)
				case strings.Contains(query(), "'d'"):
					d, found, err := tx.Delegation(ctx, "d")
					require.Error(t, err)
					require.False(t, found)
					require.Zero(t, d)
				default:
					r, found, err := tx.Revocation(ctx, "r")
					require.Error(t, err)
					require.False(t, found)
					require.Zero(t, r)
				}

				return nil
			}))
		})
	}
}

func TestSQLiteActiveTransactionRequired(t *testing.T) {
	store := newSQLiteTestStore(t, keyline.Batch{})
	conn, release, err := store.Pool.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()
	tx := keylinesqlite.Tx{Conn: conn}
	_, _, err = tx.Node(t.Context(), "n")
	require.ErrorContains(t, err, "active transaction")
	_, _, err = tx.Delegation(t.Context(), "d")
	require.ErrorContains(t, err, "active transaction")
	_, _, err = tx.Revocation(t.Context(), "r")
	require.ErrorContains(t, err, "active transaction")
	_, err = tx.Apply(t.Context(), keyline.Batch{})
	require.ErrorContains(t, err, "active transaction")
	count := 0
	for d, err := range tx.Delegations(t.Context(), "doc", "doc") {
		require.ErrorContains(t, err, "active transaction")
		require.Zero(t, d)
		count++
	}

	require.Equal(t, 1, count)
	count = 0
	for r, err := range tx.Revocations(t.Context(), "d") {
		require.ErrorContains(t, err, "active transaction")
		require.Zero(t, r)
		count++
	}

	require.Equal(t, 1, count)
}

func TestSQLiteQueryCancellation(t *testing.T) {
	for _, operation := range []string{"node", "delegation", "revocation", "delegations", "revocations", "apply", "init"} {
		t.Run(operation, func(t *testing.T) {
			ctx := t.Context()
			facts := keyline.Batch{
				Delegations: []keyline.Delegation{{"d", "doc", "alice", "doc", keyline.Read, 1}},
				Revocations: []keyline.Revocation{{"r", "alice", "d", 2}},
			}
			store := newSQLiteTestStore(t, facts)
			conn, release, err := store.Pool.WriteConn(ctx)
			require.NoError(t, err)
			defer release()
			err = sqlitex.WithTx(conn, func() error {
				// The operation context is independent of the pool's context.
				queryCtx, cancel := context.WithCancel(ctx)
				defer cancel()
				old := conn.SetInterrupt(nil)
				conn.SetInterrupt(old)
				// Cancel during preparation, after the operation's initial
				// context check. Re-registering invalidates cached statements.
				require.NoError(t, conn.SetAuthorizer(sqlite.AuthorizeFunc(func(sqlite.ActionInfo) sqlite.AuthResult {
					cancel()
					return sqlite.AuthResult(sqlite.SQLITE_OK)
				})))
				tx := keylinesqlite.Tx{Conn: conn}
				var err error

				switch operation {
				case "node":
					_, _, err = tx.Node(queryCtx, "n")
				case "delegation":
					_, _, err = tx.Delegation(queryCtx, "d")
				case "revocation":
					_, _, err = tx.Revocation(queryCtx, "r")
				case "delegations":
					count := 0
					for d, e := range tx.Delegations(queryCtx, "doc", "doc") {
						require.Zero(t, d)
						err = e
						count++
					}

					require.Equal(t, 1, count)
				case "revocations":
					count := 0
					for r, e := range tx.Revocations(queryCtx, "d") {
						require.Zero(t, r)
						err = e
						count++
					}

					require.Equal(t, 1, count)
				case "apply":
					var changed bool

					changed, err = tx.Apply(queryCtx, keyline.Batch{Nodes: []keyline.NodeRecord{{"lost", 3, 0, "lost-blob"}}})
					require.False(t, changed)
				case "init":
					err = keylinesqlite.Init(queryCtx, conn)
				}

				require.ErrorIs(t, err, context.Canceled)
				restored := conn.SetInterrupt(nil)
				require.Equal(t, old, restored, "restore the owner's exact interrupt channel")
				conn.SetInterrupt(old)
				require.NoError(t, conn.SetAuthorizer(nil))
				require.Empty(t, conn.CheckReset())
				// An interrupted write may have rolled back the outer transaction.
				// Propagate its error; only a new transaction promises reuse.
				return err
			})
			require.ErrorIs(t, err, context.Canceled)
			require.True(t, conn.GetAutocommit())
			require.NoError(t, sqlitex.WithTx(conn, func() error {
				tx := keylinesqlite.Tx{Conn: conn}
				require.Equal(t, []keyline.Record{facts.Delegations[0], facts.Revocations[0]}, collectEnumeration(t, tx.Records(ctx)), "interrupted work must not change committed records")
				changed, err := tx.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"after cancellation", 4, 0, "after-blob"}}})
				require.NoError(t, err, "the same connection remains usable in a new transaction")
				require.True(t, changed)
				return err
			}))
		})
	}
}

func TestSQLiteOwnerCancellationPreserved(t *testing.T) {
	store := newSQLiteTestStore(t, keyline.Batch{})
	ctx := t.Context()
	require.NoError(t, store.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
		owner, cancel := context.WithCancel(ctx)
		old := conn.SetInterrupt(owner.Done())
		defer conn.SetInterrupt(old)
		cancel()
		_, _, err := (keylinesqlite.Tx{Conn: conn}).Node(ctx, "n")
		require.Error(t, err, "a live query context must not mask the owner's cancellation")
		require.Equal(t, owner.Done(), conn.SetInterrupt(old))
		return nil
	}))
}

func TestSQLiteCanceledPoolWait(t *testing.T) {
	store := newSQLiteTestStore(t, keyline.Batch{})
	conn, release, err := store.Pool.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()
	require.NotNil(t, conn)
	ctx, cancel := context.WithCancel(t.Context())
	finished := make(chan error, 1)
	go func() {
		_, err := store.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"n", 1, 0, "n-blob"}}})
		finished <- err
	}()
	cancel()
	select {
	case err := <-finished:
		require.ErrorIs(t, err, context.Canceled)
	case <-t.Context().Done():
		t.Fatal("writer acquisition did not cancel")
	}
}

// A running statement is interrupted only through the connection owner's
// channel; a query context is checked before the query and between rows.
func TestSQLiteInterruptRunningQuery(t *testing.T) {
	for _, source := range []string{"owner"} {
		t.Run(source, func(t *testing.T) {
			ctx := t.Context()
			conn, err := sqlite.OpenConn(filepath.Join(t.TempDir(), "interrupt.db"), 0)
			require.NoError(t, err)
			defer func() { require.NoError(t, conn.Close()) }()
			require.NoError(t, keylinesqlite.Init(ctx, conn))
			queryCtx, cancelQuery := context.WithCancel(ctx)
			defer cancelQuery()
			ownerCtx, cancelOwner := context.WithCancel(ctx)
			defer cancelOwner()
			conn.SetInterrupt(ownerCtx.Done())
			defer conn.SetInterrupt(nil)
			started := false
			require.NoError(t, conn.CreateFunction("cancel_keyline_query", false, 0, func(result sqlite.Context, _ ...sqlite.Value) {
				started = true

				if source == "query" {
					cancelQuery()
				} else {
					cancelOwner()
				}

				result.ResultInt(1)
			}, nil, nil))
			// A deliberately expensive test-only view keeps Step running after
			// cancellation. Checking ctx only between rows cannot pass this test.
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`DROP TABLE keyline_nodes`)(), nil))
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE VIEW keyline_nodes AS
				WITH RECURSIVE numbers(n) AS (
					SELECT cancel_keyline_query()
					UNION ALL SELECT n + 1 FROM numbers WHERE n < 1000000000
				)
				SELECT 1 AS id, 'n' AS name, sum(n) AS blob_id, 0 AS ts, 'blob' AS blob_key FROM numbers`)(), nil))
			_, err = sqlitex.Read(ctx, conn, func(conn *sqlite.Conn) (struct{}, error) {
				_, _, err := (keylinesqlite.Tx{Conn: conn}).Node(queryCtx, "n")
				require.True(t, started)
				require.Error(t, err)

				if source == "query" {
					require.ErrorIs(t, err, context.Canceled)
				} else {
					require.NoError(t, queryCtx.Err())
				}

				var sqliteErr sqlite.Error

				require.ErrorAs(t, err, &sqliteErr)
				require.Equal(t, sqlite.SQLITE_INTERRUPT, sqliteErr.Code)
				require.Equal(t, ownerCtx.Done(), conn.SetInterrupt(nil))
				return struct{}{}, nil
			})
			require.NoError(t, err)
		})
	}
}

func TestSQLiteInterruptRunningWrite(t *testing.T) {
	for _, source := range []string{"owner"} {
		t.Run(source, func(t *testing.T) {
			ctx := t.Context()
			conn, err := sqlite.OpenConn(filepath.Join(t.TempDir(), "interrupted-write.db"), 0)
			require.NoError(t, err)
			defer func() { require.NoError(t, conn.Close()) }()
			require.NoError(t, keylinesqlite.Init(ctx, conn))
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE TABLE application_data (value TEXT)`)(), nil))
			tx := keylinesqlite.Tx{Conn: conn}
			base := keyline.Batch{
				Nodes:       []keyline.NodeRecord{{"committed", 1, 0, "committed-blob"}},
				Delegations: []keyline.Delegation{{"d", "doc", "alice", "doc", keyline.Read, 2}},
				Revocations: []keyline.Revocation{{"r", "alice", "missing", 3}},
			}
			require.NoError(t, sqlitex.WithTx(conn, func() error {
				_, err := tx.Apply(ctx, base)
				return err
			}))
			queryCtx, cancelQuery := context.WithCancel(ctx)
			defer cancelQuery()
			ownerCtx, cancelOwner := context.WithCancel(ctx)
			defer cancelOwner()
			previous := conn.SetInterrupt(ownerCtx.Done())
			defer conn.SetInterrupt(previous)
			seen := 0
			require.NoError(t, conn.CreateFunction("cancel_keyline_write", false, 1, func(result sqlite.Context, values ...sqlite.Value) {
				seen = values[0].Int()

				if source == "query" {
					cancelQuery()
				} else {
					cancelOwner()
				}

				result.ResultInt(1)
			}, nil, nil))
			// Cancel after the caller's write and both batch inserts are visible
			// to the running statement. Keep Step running until SQLite interrupts
			// it, rather than relying on cancellation racing a short INSERT.
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`CREATE TEMP TRIGGER interrupt_keyline_write
				AFTER INSERT ON keyline_nodes WHEN NEW.name = 'blocked' BEGIN
				SELECT sum(n) FROM (
					WITH RECURSIVE numbers(n) AS (
						SELECT cancel_keyline_write((SELECT count(*) FROM keyline_nodes
							WHERE name IN ('caller', 'staged', 'blocked')))
						UNION ALL SELECT n + 1 FROM numbers WHERE n < 1000000000
					) SELECT n FROM numbers
				);
			END`)(), nil))
			caller := keyline.Batch{Nodes: []keyline.NodeRecord{{"caller", 4, 0, "caller-blob"}}}
			pending := keyline.Batch{Nodes: []keyline.NodeRecord{{"staged", 5, 0, "staged-blob"}, {"blocked", 6, 0, "blocked-blob"}}}
			var operationErr error

			err = sqlitex.WithTx(conn, func() error {
				changed, err := tx.Apply(ctx, caller)
				require.NoError(t, err)
				require.True(t, changed)
				require.NoError(t, sqlitex.Exec(conn, dqb.Str(`INSERT INTO application_data VALUES ('caller')`)(), nil))
				changed, operationErr = tx.Apply(queryCtx, pending)
				require.Error(t, operationErr)
				require.False(t, changed)
				require.Equal(t, 3, seen, "the interruption happened inside a running write after earlier writes")
				require.True(t, conn.GetAutocommit(), "SQLite rolled back the outer transaction, including its savepoints")
				require.Empty(t, conn.CheckReset())
				_, _, err = tx.Node(ctx, "n")
				require.ErrorContains(t, err, "active transaction", "Keyline must not silently restart its caller's transaction")
				return operationErr
			})
			require.ErrorIs(t, err, operationErr, "the original transaction must propagate its failure")
			var sqliteErr sqlite.Error

			require.ErrorAs(t, err, &sqliteErr)
			require.Equal(t, sqlite.SQLITE_INTERRUPT, sqliteErr.Code)

			if source == "query" {
				require.ErrorIs(t, err, context.Canceled)
			} else {
				require.NoError(t, queryCtx.Err())
			}

			require.Equal(t, ownerCtx.Done(), conn.SetInterrupt(previous))
			require.NoError(t, sqlitex.Exec(conn, dqb.Str(`DROP TRIGGER interrupt_keyline_write`)(), nil))
			// Reuse the exact connection, in a fresh transaction, and retry all
			// caller work only after verifying committed data survived.
			require.NoError(t, sqlitex.WithTx(conn, func() error {
				require.Equal(t, []keyline.Record{base.Nodes[0], base.Delegations[0], base.Revocations[0]}, collectEnumeration(t, tx.Records(ctx)))
				count, err := sqlitex.QueryOne[int64](conn, dqb.Str(`SELECT count(*) FROM application_data`)())
				require.NoError(t, err)
				require.Zero(t, count, "the caller's earlier non-Keyline write also rolled back")
				changed, err := tx.Apply(ctx, caller)
				require.NoError(t, err)
				require.True(t, changed)
				require.NoError(t, sqlitex.Exec(conn, dqb.Str(`INSERT INTO application_data VALUES ('caller')`)(), nil))
				changed, err = tx.Apply(ctx, pending)
				require.NoError(t, err)
				require.True(t, changed)
				return nil
			}))
			require.NoError(t, sqlitex.WithTx(conn, func() error {
				require.Len(t, collectEnumeration(t, tx.Records(ctx)), 6)
				count, err := sqlitex.QueryOne[int64](conn, dqb.Str(`SELECT count(*) FROM application_data`)())
				require.NoError(t, err)
				require.EqualValues(t, 1, count)
				return nil
			}))
		})
	}
}

func TestSQLiteIteratorCleanup(t *testing.T) {
	ctx := t.Context()
	store := newSQLiteTestStore(t, keyline.Batch{
		Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Read, 1}, {"b", "doc", "bob", "doc", keyline.Read, 2}},
		Revocations: []keyline.Revocation{{"r", "alice", "a", 3}, {"s", "bob", "a", 4}},
	})
	require.NoError(t, store.View(ctx, func(reader keyline.ReadTx) error {
		tx := reader.(keylinesqlite.Tx)
		for _, mode := range []string{"break", "panic", "cancel"} {
			for _, kind := range []string{"delegations", "revocations"} {
				t.Run(mode+"/"+kind, func(t *testing.T) {
					queryCtx, cancel := context.WithCancel(ctx)
					defer cancel()
					count, failures := 0, 0
					consume := func(err error) bool {
						if err != nil {
							require.ErrorIs(t, err, context.Canceled)
							failures++
							return true // Demand termination from the iterator itself.
						}

						count++
						switch mode {
						case "break":
							return false
						case "panic":
							panic("consumer panic")
						case "cancel":
							cancel()
						}

						return true
					}

					run := func() {
						if kind == "delegations" {
							for d, err := range tx.Delegations(queryCtx, "doc", "doc") {
								if err != nil {
									require.Zero(t, d)
								}

								if !consume(err) {
									break
								}
							}
						} else {
							for r, err := range tx.Revocations(queryCtx, "a") {
								if err != nil {
									require.Zero(t, r)
								}

								if !consume(err) {
									break
								}
							}
						}
					}
					if mode == "panic" {
						require.Panics(t, run)
					} else {
						run()
					}

					require.Equal(t, 1, count)

					if mode == "cancel" {
						require.Equal(t, 1, failures)
					} else {
						require.Zero(t, failures)
					}

					require.Empty(t, tx.Conn.CheckReset(), "cleanup must precede the next query")
				})
			}
		}

		return nil
	}))
}

func newStore(t testing.TB) keyline.Store { return newSQLiteTestStore(t, keyline.Batch{}) }

func TestStore(t *testing.T) { keylinetest.Run(t, newStore) }

func TestConformance(t *testing.T) { conformance.Run(t, newStore) }

func FuzzEvaluation(f *testing.F) { conformance.FuzzEvaluation(f, newStore) }

func FuzzStructuredEvaluation(f *testing.F) { conformance.FuzzStructuredEvaluation(f, newStore) }

func BenchmarkEvaluation(b *testing.B) { keylinetest.BenchmarkEvaluation(b, newStore) }

// A writer waiting for the pool's write connection must return on cancellation.
func TestApplyCanceledWait(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		store := newSQLiteTestStore(t, keyline.Batch{})
		batch := keyline.Batch{Nodes: []keyline.NodeRecord{{"n", 1, 0, "n-blob"}}}
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		done := make(chan error, 1)
		conn, release, err := store.Pool.WriteConn(t.Context())
		require.NoError(t, err)
		require.NotNil(t, conn)
		go func() {
			changed, err := store.Apply(ctx, batch)
			if changed {
				err = fmt.Errorf("blocked update changed state")
			}

			done <- err
		}()
		synctest.Wait()
		require.Empty(t, done)
		cancel()
		synctest.Wait()
		require.Len(t, done, 1, "cancellation must not wait for the writer resource")
		require.ErrorIs(t, <-done, context.Canceled)
		release()
		keylinetest.RequireState(t, store, keyline.Batch{}, batch)
		changed, err := store.Apply(t.Context(), batch)
		require.NoError(t, err)
		require.True(t, changed)
	})
}

func allows(t *testing.T, store keyline.Store, subject, audience keyline.Node, required keyline.Power) bool {
	t.Helper()
	var allowed bool

	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		var err error

		allowed, err = keyline.Allows(t.Context(), tx, subject, audience, required)
		return err
	}))
	return allowed
}

func newSQLiteTestStore(t testing.TB, batch keyline.Batch) *keylinesqlite.Store {
	t.Helper()
	db, err := sqlitex.Open(filepath.Join(t.TempDir(), "authority.db"), 0, 4)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.WithTx(t.Context(), func(conn *sqlite.Conn) error {
		return keylinesqlite.Init(t.Context(), conn)
	}))
	store := &keylinesqlite.Store{Pool: db}
	_, err = store.Apply(t.Context(), batch)
	require.NoError(t, err)
	return store
}

func collectEnumeration[T any](t *testing.T, rows iter.Seq2[T, error]) []T {
	t.Helper()
	var result []T

	for value, err := range rows {
		require.NoError(t, err)
		result = append(result, value)
	}

	return result
}

func TestSQLiteTransactionScope(t *testing.T) {
	ctx := t.Context()
	store := newSQLiteTestStore(t, keyline.Batch{Delegations: []keyline.Delegation{{"a", "doc", "alice", "doc", keyline.Write, 1}}})
	require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
		allowed, err := keyline.Allows(ctx, tx, "doc", "alice", keyline.Write)
		require.NoError(t, err)
		require.True(t, allowed)
		// Commit a revocation while the reader's transaction remains open.
		_, err = store.Apply(ctx, keyline.Batch{Revocations: []keyline.Revocation{{"r", "alice", "a", 2}}})
		require.NoError(t, err)
		allowed, err = keyline.Allows(ctx, tx, "doc", "alice", keyline.Write)
		require.NoError(t, err)
		require.True(t, allowed, "one read transaction must observe one revision")
		return nil
	}))
	require.False(t, allows(t, store, "doc", "alice", keyline.Write), "a fresh read must observe the revocation")

	// The evaluator can use the caller's write transaction, including its
	// uncommitted facts, without opening another connection or owning commit.
	errRollback := errors.New("rollback")
	err := store.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
		if _, err := (keylinesqlite.Tx{Conn: conn}).Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{{"b", "doc", "bob", "doc", keyline.Read, 3}}}); err != nil {
			return err
		}

		allowed, err := keyline.Allows(ctx, keylinesqlite.Tx{Conn: conn}, "doc", "bob", keyline.Read)
		require.NoError(t, err)
		require.True(t, allowed)
		return errRollback
	})
	require.ErrorIs(t, err, errRollback)
	require.False(t, allows(t, store, "doc", "bob", keyline.Read), "authorization must not commit its caller's transaction")
}

func TestSQLiteTxApply(t *testing.T) {
	for _, commit := range []bool{false, true} {
		t.Run(fmt.Sprint(commit), func(t *testing.T) {
			ctx := t.Context()
			store := newSQLiteTestStore(t, keyline.Batch{})
			before := keyline.Batch{Nodes: []keyline.NodeRecord{{"before", 1, 0, "before-blob"}}}
			batch := keyline.Batch{Delegations: []keyline.Delegation{{"d", "doc", "alice", "doc", keyline.Write, 2}}}
			rollback := errors.New("caller rollback")

			err := store.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
				tx := keylinesqlite.Tx{Conn: conn}
				changed, err := tx.Apply(ctx, before)
				require.NoError(t, err)
				require.True(t, changed)
				changed, err = tx.Apply(ctx, batch)
				require.NoError(t, err)
				require.True(t, changed)
				for _, replay := range []keyline.Batch{{}, before, batch} {
					changed, err := tx.Apply(ctx, replay)
					require.NoError(t, err)
					require.False(t, changed)
				}

				changed, err = tx.Apply(ctx, keyline.Batch{Nodes: []keyline.NodeRecord{{"lost", 3, 0, "lost-blob"}, {"before", 4, 0, "before-blob"}}})
				require.ErrorIs(t, err, keyline.ErrConflict)
				require.False(t, changed)
				_, found, err := tx.Node(ctx, "lost")
				require.NoError(t, err)
				require.False(t, found)
				require.False(t, conn.GetAutocommit())
				// A separate reader cannot observe either uncommitted batch.
				keylinetest.RequireState(t, store, keyline.Batch{}, keyline.Batch{Nodes: before.Nodes, Delegations: batch.Delegations})

				if !commit {
					return rollback
				}

				return nil
			})
			if commit {
				require.NoError(t, err)
				keylinetest.RequireState(t, store, keyline.Batch{Nodes: before.Nodes, Delegations: batch.Delegations}, keyline.Batch{Nodes: []keyline.NodeRecord{{ID: "lost"}}})
			} else {
				require.ErrorIs(t, err, rollback)
				keylinetest.RequireState(t, store, keyline.Batch{}, keyline.Batch{Nodes: before.Nodes, Delegations: batch.Delegations})
			}
		})
	}
}

func TestSQLiteEnumerationGuards(t *testing.T) {
	store := newSQLiteTestStore(t, keyline.Batch{})
	_, err := store.Apply(t.Context(), keyline.Batch{
		Nodes:       []keyline.NodeRecord{{"doc", 1, 0, "doc-blob"}},
		Delegations: []keyline.Delegation{{"d", "doc", "alice", "doc", keyline.Read, 2}},
		Revocations: []keyline.Revocation{{"r", "alice", "d", 3}},
	})
	require.NoError(t, err)
	conn, release, err := store.Pool.WriteConn(t.Context())
	require.NoError(t, err)
	defer release()
	tx := keylinesqlite.Tx{Conn: conn}
	t.Run("subjects", func(t *testing.T) { testSQLiteEnumerationGuards(t, tx, tx.Subjects) })
	t.Run("records", func(t *testing.T) { testSQLiteEnumerationGuards(t, tx, tx.Records) })
	t.Run("by subject", func(t *testing.T) {
		testSQLiteEnumerationGuards(t, tx, func(ctx context.Context) iter.Seq2[keyline.Delegation, error] {
			return tx.DelegationsBySubject(ctx, "doc")
		})
	})
	t.Run("to audience", func(t *testing.T) {
		testSQLiteEnumerationGuards(t, tx, func(ctx context.Context) iter.Seq2[keyline.Delegation, error] {
			return tx.DelegationsTo(ctx, "doc", "alice")
		})
	})
}

func testSQLiteEnumerationGuards[T any](t *testing.T, tx keylinesqlite.Tx, query func(context.Context) iter.Seq2[T, error]) {
	t.Helper()
	ctx := t.Context()
	failures := 0
	for value, err := range query(ctx) {
		require.Zero(t, value)
		require.ErrorContains(t, err, "active transaction")
		failures++
	}

	require.Equal(t, 1, failures)
	require.NoError(t, sqlitex.WithTx(tx.Conn, func() error {
		want := collectEnumeration(t, query(ctx))
		var got []T

		for value, err := range query(ctx) {
			require.NoError(t, err)
			got = append(got, value)
		}

		require.ElementsMatch(t, want, got)

		for _, mode := range []string{"query cancellation", "owner cancellation", "prepare failure"} {
			func() {
				queryCtx, cancelQuery := context.WithCancel(ctx)
				defer cancelQuery()
				ownerCtx, cancelOwner := context.WithCancel(ctx)
				defer cancelOwner()
				previous := tx.Conn.SetInterrupt(ownerCtx.Done())
				defer tx.Conn.SetInterrupt(previous)

				if mode == "owner cancellation" {
					cancelOwner()
				} else {
					inject := true
					require.NoError(t, tx.Conn.SetAuthorizer(sqlite.AuthorizeFunc(func(sqlite.ActionInfo) sqlite.AuthResult {
						if !inject {
							return sqlite.AuthResult(sqlite.SQLITE_OK)
						}

						inject = false

						if mode == "query cancellation" {
							cancelQuery()
							return sqlite.AuthResult(sqlite.SQLITE_OK)
						}

						return sqlite.AuthResult(sqlite.SQLITE_DENY)
					})))
					defer func() { require.NoError(t, tx.Conn.SetAuthorizer(nil)) }()
				}

				failures := 0
				for value, err := range query(queryCtx) {
					require.Zero(t, value)
					require.Error(t, err)

					if mode == "query cancellation" {
						require.ErrorIs(t, err, context.Canceled)
					} else {
						require.NoError(t, queryCtx.Err(), "the owner or storage failed, not the query context")
					}

					failures++
				}

				require.Equal(t, 1, failures)
				require.Empty(t, tx.Conn.CheckReset())
				require.Equal(t, ownerCtx.Done(), tx.Conn.SetInterrupt(nil), "restore the owner's exact interrupt channel")
			}()
			require.ElementsMatch(t, want, collectEnumeration(t, query(ctx)), "reuse after "+mode)
		}

		return nil
	}))
}

func TestSQLiteEnumerationCorruptRows(t *testing.T) {
	for _, tc := range []struct {
		query  dqb.LazyQuery
		before int
	}{
		{dqb.Str(`UPDATE keyline_nodes SET blob_id = 0 WHERE name = 'n2'`), 1},
		{dqb.Str(`UPDATE keyline_nodes SET ts = NULL WHERE name = 'n2'`), 1},
		{dqb.Str(`UPDATE keyline_nodes SET blob_key = '' WHERE name = 'n2'`), 1},
		{dqb.Str(`UPDATE keyline_delegations SET blob_id = 0 WHERE id = 'd2'`), 3},
		{dqb.Str(`UPDATE keyline_delegations SET power = 'read' WHERE id = 'd2'`), 3},
		{dqb.Str(`UPDATE keyline_revocations SET blob_id = 0 WHERE id = 'r2'`), 5},
	} {
		t.Run(tc.query(), func(t *testing.T) {
			store := newSQLiteTestStore(t, keyline.Batch{})
			ctx := t.Context()
			batch := keyline.Batch{
				Nodes:       []keyline.NodeRecord{{"n1", 1, 0, "blob-1"}, {"n2", 2, 0, "blob-2"}},
				Delegations: []keyline.Delegation{{"d1", "doc", "alice", "doc", keyline.Read, 3}, {"d2", "doc", "alice", "doc", keyline.Read, 4}},
				Revocations: []keyline.Revocation{{"r1", "alice", "d1", 5}, {"r2", "alice", "missing", 6}},
			}
			_, err := store.Apply(ctx, batch)
			require.NoError(t, err)
			require.NoError(t, store.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
				require.NoError(t, sqlitex.Exec(conn, dqb.Str(`PRAGMA ignore_check_constraints = ON`)(), nil))
				defer func() {
					require.NoError(t, sqlitex.Exec(conn, dqb.Str(`PRAGMA ignore_check_constraints = OFF`)(), nil))
				}()
				return sqlitex.Exec(conn, tc.query(), nil)
			}))
			require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
				count, failures := 0, 0
				for record, err := range tx.Records(ctx) {
					if err != nil {
						require.Nil(t, record)
						failures++
						continue
					}

					require.Zero(t, failures, "no records after a storage error")
					count++
				}

				require.Equal(t, tc.before, count)
				require.Equal(t, 1, failures)

				if tc.before == 3 {
					for _, rows := range []iter.Seq2[keyline.Delegation, error]{tx.DelegationsBySubject(ctx, "doc"), tx.DelegationsTo(ctx, "doc", "alice")} {
						failures := 0
						for d, err := range rows {
							if err != nil {
								require.Zero(t, d)
								failures++
								continue
							}

							require.Zero(t, failures)
							require.Equal(t, batch.Delegations[0], d)
						}

						require.Equal(t, 1, failures)
					}
				}

				// Scoped queries do not decode unrelated corrupt facts.
				require.Empty(t, collectEnumeration(t, tx.DelegationsBySubject(ctx, "other")))
				require.Empty(t, collectEnumeration(t, tx.DelegationsTo(ctx, "doc", "bob")))
				_, _, err := tx.Node(ctx, "probe")
				return err
			}))
		})
	}
}

func TestSQLiteInternedNodeOrder(t *testing.T) {
	store := newSQLiteTestStore(t, keyline.Batch{})
	ctx := t.Context()
	batch := keyline.Batch{Delegations: []keyline.Delegation{
		{ID: "z", Issuer: "z", Audience: "middle", Subject: "z", Power: keyline.Read, BlobID: 1},
		{ID: "a", Issuer: "a", Audience: "middle", Subject: "a", Power: keyline.Read, BlobID: 2},
	}}
	_, err := store.Apply(ctx, batch)
	require.NoError(t, err)
	batch.Nodes = []keyline.NodeRecord{{ID: "z", BlobID: 3, BlobKey: "z-blob"}, {ID: "a", BlobID: 4, BlobKey: "a-blob"}}
	_, err = store.Apply(ctx, batch)
	require.NoError(t, err)
	require.NoError(t, store.Pool.Query(ctx, func(conn *sqlite.Conn) error {
		var names []string

		require.NoError(t, sqlitex.Exec(conn, dqb.Str(`SELECT name FROM keyline_nodes ORDER BY id`)(), func(row *sqlite.Stmt) error {
			names = append(names, row.ColumnText(0))
			return nil
		}))
		require.Equal(t, []string{"z", "middle", "a"}, names, "integer insertion order differs from name order")
		return nil
	}))
	require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
		require.Equal(t, []keyline.Node{"a", "z"}, collectEnumeration(t, tx.Subjects(ctx)))
		require.Equal(t, []keyline.Record{batch.Nodes[1], batch.Nodes[0], batch.Delegations[1], batch.Delegations[0]}, collectEnumeration(t, tx.Records(ctx)))
		return nil
	}))
}

func TestSQLiteEnumerationDanglingNodes(t *testing.T) {
	for _, tc := range []struct {
		name  string
		query dqb.LazyQuery
	}{
		{"issuer", dqb.Str(`UPDATE keyline_delegations SET issuer = 999 WHERE id = 'd'`)},
		{"audience", dqb.Str(`UPDATE keyline_delegations SET audience = 999 WHERE id = 'd'`)},
		{"subject", dqb.Str(`UPDATE keyline_delegations SET subject = 999 WHERE id = 'd'`)},
		{"revoker", dqb.Str(`UPDATE keyline_revocations SET issuer = 999 WHERE id = 'r'`)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := t.Context()
			store := newSQLiteTestStore(t, keyline.Batch{
				Delegations: []keyline.Delegation{{"d", "doc", "alice", "doc", keyline.Read, 1}},
				Revocations: []keyline.Revocation{{"r", "alice", "d", 2}},
			})
			require.NoError(t, store.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
				return sqlitex.Exec(conn, tc.query(), nil)
			}))
			require.NoError(t, store.View(ctx, func(tx keyline.ReadTx) error {
				failures := 0
				for record, err := range tx.Records(ctx) {
					if err != nil {
						require.Nil(t, record)
						failures++
						continue
					}

					require.Zero(t, failures, "stop after the dangling reference")
					require.Equal(t, "revoker", tc.name, "only the uncorrupted delegation can precede an error")
				}

				require.Equal(t, 1, failures, "a join must not hide the corrupt fact")
				var queries []iter.Seq2[keyline.Delegation, error]

				switch tc.name {
				case "issuer":
					queries = []iter.Seq2[keyline.Delegation, error]{tx.DelegationsBySubject(ctx, "doc"), tx.DelegationsTo(ctx, "doc", "alice")}
				case "audience":
					queries = []iter.Seq2[keyline.Delegation, error]{tx.DelegationsBySubject(ctx, "doc"), tx.Delegations(ctx, "doc", "doc")}
				case "subject":
					failures = 0
					for subject, err := range tx.Subjects(ctx) {
						require.Error(t, err)
						require.Zero(t, subject)
						failures++
					}

					require.Equal(t, 1, failures)
				case "revoker":
					failures = 0
					for r, err := range tx.Revocations(ctx, "d") {
						require.Error(t, err)
						require.Zero(t, r)
						failures++
					}

					require.Equal(t, 1, failures)
				}

				for _, rows := range queries {
					failures = 0
					for d, err := range rows {
						require.Error(t, err)
						require.Zero(t, d)
						failures++
					}

					require.Equal(t, 1, failures)
				}

				return nil
			}))
		})
	}
}
