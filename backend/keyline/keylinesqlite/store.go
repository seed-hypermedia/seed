// Package keylinesqlite implements SQLite storage for Keyline records.
//
// Node names are interned in keyline_nodes; delegations and revocation issuers
// reference those local integer IDs, which queries and exports never return.
// A node referenced only by facts has NULL mention metadata until a NodeRecord
// arrives, and improving that metadata keeps its ID. Delegations and
// revocations share one fact-ID namespace across their separate tables.
package keylinesqlite

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"strings"

	"seed/backend/keyline"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Store stores Keyline records in a caller-owned pool. Call Init on
// its write connection before use. Closing the pool remains the caller's job.
type Store struct {
	Pool *sqlitex.Pool
}

// Tx accesses a caller-owned, already active SQLite transaction. It never
// commits that transaction, and its queries see facts applied earlier in it,
// so authorization and the protected write can share it. Finish queries and
// iterators before another operation on Conn: statements are cached per
// connection, so a nested call to the same query would reset the outer cursor.
//
// Cancellation is checked before each query and between rows. A statement
// already running is interrupted only through the connection's own interrupt
// channel, which the pool sets per transaction.
//
// SQLite may roll back the entire transaction on a storage error or interrupted
// write. Callers must propagate storage and cancellation errors and abort their
// transaction. A retry must repeat the whole operation in a new transaction,
// including authorization reads and earlier writes. Tx never restarts a
// caller's transaction.
type Tx struct {
	Conn *sqlite.Conn
}

var (
	_ keyline.Store  = Store{}
	_ keyline.ReadTx = Tx{}

	// DDL is verified by Init, not prepared against an existing schema by
	// dqb.GlobalQueries.Test. Keep ordinary store queries registered globally.
	sqliteDDL dqb.Queries
	// Match storage/schema.sql exactly after dqb's indentation formatting.
	sqliteSchema = []struct {
		name string
		ddl  dqb.LazyQuery
	}{
		{"keyline_nodes", sqliteDDL.Str(`
		CREATE TABLE keyline_nodes (
			id INTEGER PRIMARY KEY,
			name TEXT UNIQUE NOT NULL CHECK (name != ''),
			blob_id INTEGER CHECK (blob_id > 0),
			ts INTEGER,
			blob_key TEXT CHECK (blob_key != ''),
			CHECK ((blob_id IS NULL AND ts IS NULL AND blob_key IS NULL) OR (blob_id IS NOT NULL AND ts IS NOT NULL AND blob_key IS NOT NULL))
		) STRICT`)},
		{"keyline_delegations", sqliteDDL.Str(`
		CREATE TABLE keyline_delegations (
			id TEXT PRIMARY KEY CHECK (id != ''),
			issuer INTEGER NOT NULL REFERENCES keyline_nodes (id),
			audience INTEGER NOT NULL REFERENCES keyline_nodes (id),
			subject INTEGER NOT NULL REFERENCES keyline_nodes (id),
			power TEXT NOT NULL CHECK (power IN ('s', 'r', 'w', 'a')),
			blob_id INTEGER NOT NULL CHECK (blob_id > 0)
		) STRICT, WITHOUT ROWID`)},
		{"keyline_revocations", sqliteDDL.Str(`
		CREATE TABLE keyline_revocations (
			id TEXT PRIMARY KEY CHECK (id != ''),
			issuer INTEGER NOT NULL REFERENCES keyline_nodes (id),
			target TEXT NOT NULL CHECK (target != ''),
			blob_id INTEGER NOT NULL CHECK (blob_id > 0)
		) STRICT, WITHOUT ROWID`)},
		{"keyline_outgoing", sqliteDDL.Str(`CREATE INDEX keyline_outgoing ON keyline_delegations (subject, issuer)`)},
		{"keyline_delegations_by_issuer", sqliteDDL.Str(`CREATE INDEX keyline_delegations_by_issuer ON keyline_delegations (issuer)`)},
		{"keyline_delegations_by_audience", sqliteDDL.Str(`CREATE INDEX keyline_delegations_by_audience ON keyline_delegations (audience)`)},
		{"keyline_targeting", sqliteDDL.Str(`CREATE INDEX keyline_targeting ON keyline_revocations (target)`)},
		{"keyline_revocations_by_issuer", sqliteDDL.Str(`CREATE INDEX keyline_revocations_by_issuer ON keyline_revocations (issuer)`)},
	}
	// Include the legacy fact table so incompatible schemas still fail closed.
	sqliteSchemaObjects = dqb.Str(`SELECT name, sql FROM sqlite_schema WHERE name IN (
		'keyline_nodes', 'keyline_delegations', 'keyline_revocations',
		'keyline_outgoing', 'keyline_delegations_by_issuer', 'keyline_delegations_by_audience',
		'keyline_targeting', 'keyline_revocations_by_issuer', 'keyline_facts')`)
	sqliteNode = dqb.Str(`SELECT name, blob_id, ts, blob_key FROM keyline_nodes WHERE name = ? AND blob_id IS NOT NULL`)
	// LEFT JOIN preserves corrupt dangling references for the decoders to reject.
	sqliteDelegation = dqb.Str(`SELECT d.id, issuer.name, audience.name, subject.name, d.power, d.blob_id
		FROM keyline_delegations AS d
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = d.issuer
		LEFT JOIN keyline_nodes AS audience ON audience.id = d.audience
		LEFT JOIN keyline_nodes AS subject ON subject.id = d.subject
		WHERE d.id = ?`)
	sqliteRevocation = dqb.Str(`SELECT r.id, issuer.name, r.target, r.blob_id
		FROM keyline_revocations AS r
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = r.issuer
		WHERE r.id = ?`)
	sqliteOutgoing = dqb.Str(`SELECT d.id, issuer.name, audience.name, subject.name, d.power, d.blob_id
		FROM keyline_delegations AS d
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = d.issuer
		LEFT JOIN keyline_nodes AS audience ON audience.id = d.audience
		LEFT JOIN keyline_nodes AS subject ON subject.id = d.subject
		WHERE d.subject = (SELECT id FROM keyline_nodes WHERE name = ?)
		AND d.issuer = (SELECT id FROM keyline_nodes WHERE name = ?)`)
	sqliteBySubject = dqb.Str(`SELECT d.id, issuer.name, audience.name, subject.name, d.power, d.blob_id
		FROM keyline_delegations AS d
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = d.issuer
		LEFT JOIN keyline_nodes AS audience ON audience.id = d.audience
		LEFT JOIN keyline_nodes AS subject ON subject.id = d.subject
		WHERE d.subject = (SELECT id FROM keyline_nodes WHERE name = ?)`)
	sqliteToAudience = dqb.Str(`SELECT d.id, issuer.name, audience.name, subject.name, d.power, d.blob_id
		FROM keyline_delegations AS d
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = d.issuer
		LEFT JOIN keyline_nodes AS audience ON audience.id = d.audience
		LEFT JOIN keyline_nodes AS subject ON subject.id = d.subject
		WHERE d.subject = (SELECT id FROM keyline_nodes WHERE name = ?)
		AND d.audience = (SELECT id FROM keyline_nodes WHERE name = ?)`)
	sqliteTargeting = dqb.Str(`SELECT r.id, issuer.name, r.target, r.blob_id
		FROM keyline_revocations AS r
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = r.issuer
		WHERE r.target = ?`)
	sqliteSubjects = dqb.Str(`SELECT DISTINCT subject.name
		FROM keyline_delegations AS d
		LEFT JOIN keyline_nodes AS subject ON subject.id = d.subject
		ORDER BY subject.name COLLATE BINARY`)
	sqliteAllNodes = dqb.Str(`SELECT name, blob_id, ts, blob_key FROM keyline_nodes WHERE blob_id IS NOT NULL ORDER BY name COLLATE BINARY`)
	// Scan the WITHOUT ROWID primary key, not a secondary index followed by a
	// whole-group sort, so Records can stream in ID order with bounded memory.
	sqliteAllDelegations = dqb.Str(`SELECT d.id, issuer.name, audience.name, subject.name, d.power, d.blob_id
		FROM keyline_delegations AS d NOT INDEXED
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = d.issuer
		LEFT JOIN keyline_nodes AS audience ON audience.id = d.audience
		LEFT JOIN keyline_nodes AS subject ON subject.id = d.subject
		ORDER BY d.id COLLATE BINARY`)
	sqliteAllRevocations = dqb.Str(`SELECT r.id, issuer.name, r.target, r.blob_id
		FROM keyline_revocations AS r NOT INDEXED
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = r.issuer
		ORDER BY r.id COLLATE BINARY`)
	sqliteInternNode = dqb.Str(`INSERT INTO keyline_nodes(name) VALUES (?) ON CONFLICT(name) DO NOTHING`)
	sqliteNodeID     = dqb.Str(`SELECT id FROM keyline_nodes WHERE name = ?`)
	sqliteInsertNode = dqb.Str(`INSERT INTO keyline_nodes(name, blob_id, ts, blob_key) VALUES (?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET blob_id = excluded.blob_id, ts = excluded.ts, blob_key = excluded.blob_key`)
	sqliteInsertDelegation = dqb.Str(`INSERT INTO keyline_delegations(id, issuer, audience, subject, power, blob_id)
		VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
	sqliteInsertRevocation = dqb.Str(`INSERT INTO keyline_revocations(id, issuer, target, blob_id)
		VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
)

// Init creates or verifies the Keyline schema atomically.
// It checks only the store's owned schema names, including the legacy facts table.
// Other application objects may share the keyline_ prefix. Incompatible owned
// objects are errors; Init performs no migrations or application writes.
// Within an existing transaction, initialization remains uncommitted.
func Init(ctx context.Context, conn *sqlite.Conn) (err error) {
	if err := ctx.Err(); err != nil {
		return err
	}

	defer sqlitex.Save(conn)(&err)

	objects := make(map[string]string)
	rows, discard, check := sqlitex.Query(conn, sqliteSchemaObjects()).All()
	defer discard(&err)
	for row := range rows {
		objects[row.ColumnText(0)] = row.ColumnText(1)
	}

	if err := check(); err != nil {
		return err
	}

	if len(objects) == 0 {
		for _, obj := range sqliteSchema {
			if err := sqlitex.Exec(conn, obj.ddl(), nil); err != nil {
				return err
			}
		}
	} else {
		if len(objects) != len(sqliteSchema) {
			return fmt.Errorf("keyline: incompatible SQLite schema objects")
		}

		for _, obj := range sqliteSchema {
			if strings.TrimSpace(objects[obj.name]) != strings.TrimSpace(obj.ddl()) {
				return fmt.Errorf("keyline: incompatible SQLite schema object %q", obj.name)
			}
		}
	}

	return ctx.Err()
}

// View invokes fn in one consistent SQLite read transaction, releasing it on
// return or panic. All iterators must be consumed before fn returns.
func (s Store) View(ctx context.Context, fn func(keyline.ReadTx) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	_, err := sqlitex.Read(ctx, s.Pool, func(conn *sqlite.Conn) (struct{}, error) {
		if err := ctx.Err(); err != nil {
			return struct{}{}, err
		}

		return struct{}{}, errors.Join(fn(Tx{Conn: conn}), ctx.Err())
	})
	if err != nil {
		return errors.Join(err, ctx.Err())
	}

	return nil
}

// Apply commits an authenticated batch atomically, reporting new facts or
// improved node provenance. A failed batch returns changed=false.
func (s Store) Apply(ctx context.Context, batch keyline.Batch) (changed bool, err error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}

	err = s.Pool.WithTx(ctx, func(conn *sqlite.Conn) error {
		var err error

		changed, err = (Tx{Conn: conn}).Apply(ctx, batch)
		return err
	})
	if err != nil {
		return false, errors.Join(err, ctx.Err())
	}

	return changed, nil
}

// Apply inserts a batch under a nested savepoint. A conflict or validation
// failure rolls back this batch while preserving the caller's earlier writes.
// Storage errors and cancellation may abort the whole transaction; see Tx.
func (tx Tx) Apply(ctx context.Context, batch keyline.Batch) (changed bool, err error) {
	defer func() {
		if err != nil {
			changed = false
		}
	}()

	if err := tx.active(ctx); err != nil {
		return false, err
	}

	defer sqlitex.Save(tx.Conn)(&err)

	for _, n := range batch.Nodes {
		if err := n.Validate(); err != nil {
			return false, err
		}

		old, found, err := tx.Node(ctx, n.ID)
		if err != nil {
			return false, err
		}

		if found {
			if old.BlobKey == n.BlobKey && old != n {
				return false, fmt.Errorf("%w: node %q", keyline.ErrConflict, n.ID)
			}

			if n.Timestamp > old.Timestamp || (n.Timestamp == old.Timestamp && n.BlobKey >= old.BlobKey) {
				continue
			}
		}

		if err := sqlitex.Exec(tx.Conn, sqliteInsertNode(), nil, n.ID, n.BlobID, n.Timestamp, n.BlobKey); err != nil {
			return false, err
		}

		changed = true
	}

	for _, d := range batch.Delegations {
		if err := d.Validate(); err != nil {
			return false, err
		}

		// Both fact tables share an ID namespace within this transaction.
		if _, found, err := tx.Revocation(ctx, d.ID); err != nil {
			return false, err
		} else if found {
			return false, fmt.Errorf("%w: delegation %q", keyline.ErrConflict, d.ID)
		}

		issuer, err := tx.internNode(d.Issuer)
		if err != nil {
			return false, err
		}

		audience, err := tx.internNode(d.Audience)
		if err != nil {
			return false, err
		}

		subject, err := tx.internNode(d.Subject)
		if err != nil {
			return false, err
		}

		if err := sqlitex.Exec(tx.Conn, sqliteInsertDelegation(), nil, d.ID, issuer, audience, subject, d.Power.String(), d.BlobID); err != nil {
			return false, err
		}

		if tx.Conn.Changes() != 0 {
			changed = true
		} else if old, found, err := tx.Delegation(ctx, d.ID); err != nil {
			return false, err
		} else if !found || old != d {
			return false, fmt.Errorf("%w: delegation %q", keyline.ErrConflict, d.ID)
		}
	}

	for _, r := range batch.Revocations {
		if err := r.Validate(); err != nil {
			return false, err
		}

		if _, found, err := tx.Delegation(ctx, r.ID); err != nil {
			return false, err
		} else if found {
			return false, fmt.Errorf("%w: revocation %q", keyline.ErrConflict, r.ID)
		}

		issuer, err := tx.internNode(r.Issuer)
		if err != nil {
			return false, err
		}

		if err := sqlitex.Exec(tx.Conn, sqliteInsertRevocation(), nil, r.ID, issuer, r.Target, r.BlobID); err != nil {
			return false, err
		}

		if tx.Conn.Changes() != 0 {
			changed = true
		} else if old, found, err := tx.Revocation(ctx, r.ID); err != nil {
			return false, err
		} else if !found || old != r {
			return false, fmt.Errorf("%w: revocation %q", keyline.ErrConflict, r.ID)
		}
	}

	return changed, ctx.Err()
}

// InternNode returns name's local integer ID, adding the name if needed, so
// application tables in the same database can reference nodes by ID, including
// nodes no stored fact names. Interning records no mention, and IDs are local
// to this database. Name must be nonempty.
func (tx Tx) InternNode(ctx context.Context, name keyline.Node) (int64, error) {
	if err := tx.active(ctx); err != nil {
		return 0, err
	}

	if name == "" {
		return 0, fmt.Errorf("keyline: cannot intern an empty node name")
	}

	return tx.internNode(name)
}

// internNode runs inside Apply's savepoint. Interning alone
// does not record a mention.
func (tx Tx) internNode(name keyline.Node) (int64, error) {
	if err := sqlitex.Exec(tx.Conn, sqliteInternNode(), nil, name); err != nil {
		return 0, err
	}

	return sqlitex.QueryOne[int64](tx.Conn, sqliteNodeID(), name)
}

// Node returns the earliest-known mention, excluding reference-only nodes.
func (tx Tx) Node(ctx context.Context, id keyline.Node) (keyline.NodeRecord, bool, error) {
	return sqliteOne(ctx, tx, sqliteNode(), decodeSQLiteNode, id)
}

// Delegation returns an immutable delegation by ID, including ungrounded facts.
func (tx Tx) Delegation(ctx context.Context, id keyline.ID) (keyline.Delegation, bool, error) {
	return sqliteOne(ctx, tx, sqliteDelegation(), decodeSQLiteDelegation, id)
}

// Revocation returns an immutable revocation by ID, including missing targets.
func (tx Tx) Revocation(ctx context.Context, id keyline.ID) (keyline.Revocation, bool, error) {
	return sqliteOne(ctx, tx, sqliteRevocation(), decodeSQLiteRevocation, id)
}

// Delegations lazily reads the indexed outgoing facts for subject and issuer.
func (tx Tx) Delegations(ctx context.Context, subject, issuer keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return sqliteRows(ctx, tx, sqliteOutgoing(), decodeSQLiteDelegation, subject, issuer)
}

// Revocations lazily reads the indexed revocations naming target.
func (tx Tx) Revocations(ctx context.Context, target keyline.ID) iter.Seq2[keyline.Revocation, error] {
	return sqliteRows(ctx, tx, sqliteTargeting(), decodeSQLiteRevocation, target)
}

// DelegationsBySubject lazily reads all facts under the subject index prefix.
func (tx Tx) DelegationsBySubject(ctx context.Context, subject keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return sqliteRows(ctx, tx, sqliteBySubject(), decodeSQLiteDelegation, subject)
}

// DelegationsTo lazily reads indexed facts for subject and audience, including dead facts.
func (tx Tx) DelegationsTo(ctx context.Context, subject, audience keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return sqliteRows(ctx, tx, sqliteToAudience(), decodeSQLiteDelegation, subject, audience)
}

// Subjects streams distinct delegation subjects in bytewise ascending order.
func (tx Tx) Subjects(ctx context.Context) iter.Seq2[keyline.Node, error] {
	return sqliteRows(ctx, tx, sqliteSubjects(), func(row *sqlite.Stmt) (keyline.Node, error) {
		subject := keyline.Node(row.ColumnText(0))
		if subject == "" {
			return "", fmt.Errorf("keyline: invalid SQLite subject")
		}

		return subject, nil
	})
}

// Records streams nodes, delegations, and revocations in bytewise ID order within
// each group. Each cursor is released before the next group's query starts.
func (tx Tx) Records(ctx context.Context) iter.Seq2[keyline.Record, error] {
	return func(yield func(keyline.Record, error) bool) {
		for _, rows := range []iter.Seq2[keyline.Record, error]{
			sqliteRows(ctx, tx, sqliteAllNodes(), func(row *sqlite.Stmt) (keyline.Record, error) {
				return decodeSQLiteNode(row)
			}),
			sqliteRows(ctx, tx, sqliteAllDelegations(), func(row *sqlite.Stmt) (keyline.Record, error) {
				return decodeSQLiteDelegation(row)
			}),
			sqliteRows(ctx, tx, sqliteAllRevocations(), func(row *sqlite.Stmt) (keyline.Record, error) {
				return decodeSQLiteRevocation(row)
			}),
		} {
			for record, err := range rows {
				if !yield(record, err) || err != nil {
					return
				}
			}
		}
	}
}

func decodeSQLiteNode(row *sqlite.Stmt) (keyline.NodeRecord, error) {
	if row.ColumnType(2) != sqlite.SQLITE_INTEGER {
		return keyline.NodeRecord{}, fmt.Errorf("keyline: invalid SQLite node timestamp type")
	}

	n := keyline.NodeRecord{
		ID: keyline.Node(row.ColumnText(0)), BlobID: row.ColumnInt64(1),
		Timestamp: row.ColumnInt64(2), BlobKey: row.ColumnText(3),
	}
	return n, n.Validate()
}

func decodeSQLiteDelegation(row *sqlite.Stmt) (keyline.Delegation, error) {
	if row.ColumnType(4) != sqlite.SQLITE_TEXT {
		return keyline.Delegation{}, fmt.Errorf("keyline: invalid SQLite power type")
	}

	power, err := keyline.ParsePower(row.ColumnText(4))
	if err != nil {
		return keyline.Delegation{}, fmt.Errorf("keyline: invalid SQLite power: %w", err)
	}

	d := keyline.Delegation{
		ID: keyline.ID(row.ColumnText(0)), Issuer: keyline.Node(row.ColumnText(1)), Audience: keyline.Node(row.ColumnText(2)),
		Subject: keyline.Node(row.ColumnText(3)), Power: power, BlobID: row.ColumnInt64(5),
	}
	return d, d.Validate()
}

func decodeSQLiteRevocation(row *sqlite.Stmt) (keyline.Revocation, error) {
	r := keyline.Revocation{ID: keyline.ID(row.ColumnText(0)), Issuer: keyline.Node(row.ColumnText(1)), Target: keyline.ID(row.ColumnText(2)), BlobID: row.ColumnInt64(3)}
	return r, r.Validate()
}

func (tx Tx) active(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if tx.Conn == nil || tx.Conn.GetAutocommit() {
		return fmt.Errorf("keyline: SQLiteTx requires an active transaction")
	}

	return nil
}

func sqliteOne[T any](ctx context.Context, tx Tx, query string, decode func(*sqlite.Stmt) (T, error), args ...any) (value T, found bool, err error) {
	for v, err := range sqliteRows(ctx, tx, query, decode, args...) {
		if err != nil {
			var zero T

			return zero, false, err
		}

		value, found = v, true
	}

	return value, found, nil
}

func sqliteRows[T any](ctx context.Context, tx Tx, query string, decode func(*sqlite.Stmt) (T, error), args ...any) iter.Seq2[T, error] {
	return func(yield func(T, error) bool) {
		stopped := false

		err := func() (err error) {
			if err := tx.active(ctx); err != nil {
				return err
			}

			rows, discard, check := sqlitex.Query(tx.Conn, query, args...).All()
			defer discard(&err)
			for row := range rows {
				if err := ctx.Err(); err != nil {
					return err
				}

				value, err := decode(row)
				if err != nil {
					return err
				}

				if !yield(value, nil) {
					stopped = true
					return nil
				}
			}

			return errors.Join(check(), ctx.Err())
		}()
		if err != nil && !stopped {
			var zero T

			yield(zero, err)
		}
	}
}
