// Package keylinesqlite is Seed's SQLite store for Keyline records. It is not
// part of the Keyline port: it implements the port's Store and ReadTx
// contracts, passes the same conformance suite as keylinemem, and adds what
// Seed needs, such as stored edges. Its tables are defined in Seed's
// storage/schema.sql and change through Seed's migrations, like any other
// table. Their blob_id columns reference blobs, so a blob that Keyline cites
// cannot be deleted. An implied delegation stores a NULL blob_id.
//
// Node names are interned in keyline_nodes; delegations and revocation issuers
// reference those local integer IDs, which queries and exports never return.
// A node referenced only by facts has NULL mention metadata until a NodeRecord
// arrives, and improving that metadata keeps its ID. Delegations and
// revocations share one fact-ID namespace across their separate tables.
//
// keyline_edges keeps every subject's evaluated edges, one row per subject and
// audience: the strongest keyline.Conveyed among its delegations to that
// audience. Apply updates it in the same savepoint as the facts, and Tx.Allows
// answers from it as a reachability query instead of an evaluation. Storage grows with the number of
// delegations, not with subjects times their transitive members.
package keylinesqlite

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"maps"
	"slices"

	"seed/backend/keyline"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Store stores Keyline records in a caller-owned pool with Seed's schema.
// Closing the pool remains the caller's job.
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
	// Scan the unique ID index, not the table followed by a whole-group sort,
	// so Records can stream in ID order with bounded memory.
	sqliteAllDelegations = dqb.Str(`SELECT d.id, issuer.name, audience.name, subject.name, d.power, d.blob_id
		FROM keyline_delegations AS d
		LEFT JOIN keyline_nodes AS issuer ON issuer.id = d.issuer
		LEFT JOIN keyline_nodes AS audience ON audience.id = d.audience
		LEFT JOIN keyline_nodes AS subject ON subject.id = d.subject
		ORDER BY d.id COLLATE BINARY`)
	sqliteAllRevocations = dqb.Str(`SELECT r.id, issuer.name, r.target, r.blob_id
		FROM keyline_revocations AS r
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
	sqliteHasRevocations = dqb.Str(`SELECT EXISTS (SELECT 1 FROM keyline_revocations)`)
	sqliteEdgesOf        = dqb.Str(`SELECT audience.name, e.power
		FROM keyline_edges AS e
		JOIN keyline_nodes AS audience ON audience.id = e.audience
		WHERE e.subject = (SELECT id FROM keyline_nodes WHERE name = ?)`)
	sqliteUpsertEdge = dqb.Str(`INSERT INTO keyline_edges(subject, audience, power)
		VALUES ((SELECT id FROM keyline_nodes WHERE name = ?1), (SELECT id FROM keyline_nodes WHERE name = ?2), ?3)
		ON CONFLICT(subject, audience) DO UPDATE SET power = excluded.power`)
	sqliteDeleteEdge = dqb.Str(`DELETE FROM keyline_edges
		WHERE subject = (SELECT id FROM keyline_nodes WHERE name = ?)
		AND audience = (SELECT id FROM keyline_nodes WHERE name = ?)`)
	// Subjects whose delegations may lead to any of the named nodes, themselves
	// included when they have delegations.
	sqliteSubjectsReaching = dqb.Str(`WITH RECURSIVE backward(n) AS (
			SELECT id FROM keyline_nodes WHERE name IN (SELECT value FROM json_each(?))
			UNION
			SELECT d.subject FROM keyline_delegations AS d JOIN backward AS b ON d.audience = b.n
		)
		SELECT name FROM keyline_nodes
		WHERE id IN (SELECT n FROM backward) AND id IN (SELECT subject FROM keyline_delegations)`)
	// Subjects that may lead to ?1 and hold a delegation whose issuer ?2 may
	// lead to: the subjects whose edges a changed edge from ?1 to ?2 can change.
	sqliteSubjectsThrough = dqb.Str(`WITH RECURSIVE
		forward(n) AS (
			SELECT id FROM keyline_nodes WHERE name = ?2
			UNION
			SELECT d.audience FROM keyline_delegations AS d JOIN forward AS f ON d.subject = f.n
		),
		backward(n) AS (
			SELECT id FROM keyline_nodes WHERE name = ?1
			UNION
			SELECT d.subject FROM keyline_delegations AS d JOIN backward AS b ON d.audience = b.n
		)
		SELECT DISTINCT subject.name
		FROM keyline_delegations AS d
		JOIN keyline_nodes AS subject ON subject.id = d.subject
		WHERE d.issuer IN (SELECT n FROM forward) AND d.subject IN (SELECT n FROM backward)`)
	sqliteReaches = dqb.Q(func() string {
		return "SELECT " + SQLReaches("?1", "?2", "?3")
	})
)

// SQLReaches returns an SQL boolean expression for Tx.Allows
// over the edges this package stores. subjects is an SQL expression list of
// node names, and audience an SQL expression for one node name; either may
// refer to columns of an enclosing query. required is an SQL expression for
// the weakest accepted power, as its keyline.Power number. The expression is
// true when stored edges lead from any of subjects to audience, each
// conveying at least required, which equals
// keyline.Allows over each subject combined with OR. Distinct subjects and
// audience are required: a node's power over itself is not stored.
func SQLReaches(subjects, audience, required string) string {
	return `EXISTS (
		WITH RECURSIVE reach(n) AS (
			SELECT id FROM keyline_nodes WHERE name IN (` + subjects + `)
			UNION
			SELECT e.audience FROM keyline_edges AS e JOIN reach AS r ON e.subject = r.n
			WHERE e.power >= ` + required + `
		)
		SELECT 1 FROM reach WHERE n = (SELECT id FROM keyline_nodes WHERE name = ` + audience + `)
	)`
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

	// Subjects whose stored edges new facts may change.
	stale := make(map[keyline.Node]bool)
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

		// An implied delegation has no blob, stored as NULL.
		var blobID any

		if !d.Implied() {
			blobID = d.BlobID
		}

		if err := sqlitex.Exec(tx.Conn, sqliteInsertDelegation(), nil, d.ID, issuer, audience, subject, int(d.Power), blobID); err != nil {
			return false, err
		}

		if tx.Conn.Changes() != 0 {
			changed = true
			stale[d.Subject] = true
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

			if target, found, err := tx.Delegation(ctx, r.Target); err != nil {
				return false, err
			} else if found {
				stale[target.Subject] = true
			}
		} else if old, found, err := tx.Revocation(ctx, r.ID); err != nil {
			return false, err
		} else if !found || old != r {
			return false, fmt.Errorf("%w: revocation %q", keyline.ErrConflict, r.ID)
		}
	}

	if err := tx.refreshEdges(ctx, stale); err != nil {
		return false, err
	}

	return changed, ctx.Err()
}

// refreshEdges brings the stored edges of every subject that new facts about
// stale subjects can change back to their evaluated values: per audience, the
// strongest keyline.Conveyed among the subject's delegations. It writes only
// rows that differ.
//
// Each subject is evaluated on its own (see evaluateEdges), reading the stored
// edges of the nodes it reaches, so a refresh costs what the changed subjects
// reach rather than whole connected groups squared.
//
// Without revocations, authority only grows with new facts. Re-evaluating the
// stale subjects and then every subject a changed edge can affect therefore
// reaches the new fixed point from the old one. A revocation can shrink
// authority, and a grant can widen a revoker's reach, so while any revocation
// is stored every subject that may lead to a stale one is cleared and
// re-evaluated until nothing changes, which climbs to the least fixed point
// from below and never lets a cycle keep authority it lost.
func (tx Tx) refreshEdges(ctx context.Context, stale map[keyline.Node]bool) error {
	if len(stale) == 0 {
		return nil
	}

	hasRevocations, err := sqlitex.QueryOne[int](tx.Conn, sqliteHasRevocations())
	if err != nil {
		return err
	}

	if hasRevocations == 0 {
		return tx.growEdges(ctx, slices.Sorted(maps.Keys(stale)))
	}

	return tx.rebuildEdges(ctx, stale)
}

// growEdges re-evaluates pending subjects and follows every changed edge to
// the subjects it can affect, until nothing changes. It assumes authority only
// grows, which holds while no revocation is stored.
func (tx Tx) growEdges(ctx context.Context, pending []keyline.Node) error {
	queued := make(map[keyline.Node]bool, len(pending))
	for _, n := range pending {
		queued[n] = true
	}

	for len(pending) > 0 {
		subject := pending[0]
		pending = pending[1:]
		queued[subject] = false

		want, err := tx.evaluateEdges(ctx, subject)
		if err != nil {
			return err
		}

		changed, err := tx.writeEdges(ctx, subject, want)
		if err != nil {
			return err
		}

		for _, audience := range changed {
			var next []keyline.Node

			for n, err := range sqliteRows(ctx, tx, sqliteSubjectsThrough(), decodeSQLiteName, subject, audience) {
				if err != nil {
					return err
				}

				next = append(next, n)
			}

			for _, n := range next {
				if !queued[n] {
					queued[n] = true
					pending = append(pending, n)
				}
			}
		}
	}

	return nil
}

// rebuildEdges clears the edges of every subject that may lead to a stale one
// and re-evaluates them in rounds until a round changes nothing. Subjects that
// cannot lead to a stale one keep their edges: their evaluation never reads
// the cleared ones.
func (tx Tx) rebuildEdges(ctx context.Context, stale map[keyline.Node]bool) error {
	names, err := json.Marshal(slices.Sorted(maps.Keys(stale)))
	if err != nil {
		return err
	}

	var region []keyline.Node

	for n, err := range sqliteRows(ctx, tx, sqliteSubjectsReaching(), decodeSQLiteName, string(names)) {
		if err != nil {
			return err
		}

		region = append(region, n)
	}

	slices.Sort(region)

	for _, subject := range region {
		if _, err := tx.writeEdges(ctx, subject, nil); err != nil {
			return err
		}
	}

	for changed := true; changed; {
		changed = false
		for _, subject := range region {
			want, err := tx.evaluateEdges(ctx, subject)
			if err != nil {
				return err
			}

			diff, err := tx.writeEdges(ctx, subject, want)
			if err != nil {
				return err
			}

			changed = changed || len(diff) > 0
		}
	}

	return nil
}

// evaluateEdges returns subject's evaluated edges from its own delegations and
// the stored edges of the nodes it reaches.
//
// A node's power over subject is the widest path from subject: through
// subject's delegations from nodes that already hold power over it, and through
// other nodes' stored edges, which carry their members. A delegation conveys its
// requested power, capped by its issuer's power over subject. That is
// keyline.Conveyed for every delegation no revocation names, given current
// edges elsewhere. A subject with a revoked delegation takes keyline.Conveyed
// from the core instead, which evaluates revocation coverage from raw facts.
//
// The search visits nodes strongest first and stops once every issuer of
// subject's delegations is settled, so in practice it reads only the few nodes
// between subject and its issuers.
func (tx Tx) evaluateEdges(ctx context.Context, subject keyline.Node) (map[keyline.Node]keyline.Power, error) {
	var delegations []keyline.Delegation

	for d, err := range tx.DelegationsBySubject(ctx, subject) {
		if err != nil {
			return nil, err
		}

		delegations = append(delegations, d)
	}

	revoked := false
	for _, d := range delegations {
		for _, err := range tx.Revocations(ctx, d.ID) {
			if err != nil {
				return nil, err
			}

			revoked = true
			break
		}

		if revoked {
			break
		}
	}

	want := make(map[keyline.Node]keyline.Power)
	convey := func(d keyline.Delegation, p keyline.Power) {
		if p != keyline.None && d.Audience != subject && p > want[d.Audience] {
			want[d.Audience] = p
		}
	}

	if revoked {
		for _, d := range delegations {
			p, err := keyline.Conveyed(ctx, tx, d.ID)
			if err != nil {
				return nil, err
			}

			convey(d, p)
		}

		return want, nil
	}

	byIssuer := make(map[keyline.Node][]keyline.Delegation)
	unsettled := make(map[keyline.Node]bool)
	for _, d := range delegations {
		byIssuer[d.Issuer] = append(byIssuer[d.Issuer], d)
		unsettled[d.Issuer] = true
	}

	// Buckets by power, strongest first: a node leaves its bucket with its
	// final power, because every path through it can only weaken.
	ladder := []keyline.Power{keyline.Sync, keyline.Read, keyline.Write, keyline.Admin}
	best := map[keyline.Node]keyline.Power{subject: keyline.Admin}
	buckets := map[keyline.Power][]keyline.Node{keyline.Admin: {subject}}
	relax := func(n keyline.Node, p keyline.Power) {
		if p != keyline.None && p > best[n] {
			best[n] = p
			buckets[p] = append(buckets[p], n)
		}
	}

search:
	for i := len(ladder) - 1; i >= 0; i-- {
		level := ladder[i]
		for j := 0; j < len(buckets[level]); j++ {
			if err := ctx.Err(); err != nil {
				return nil, err
			}

			n := buckets[level][j]
			if best[n] != level {
				continue // Raised later; that entry handles it.
			}

			delete(unsettled, n)

			if len(unsettled) == 0 {
				break search
			}

			for _, d := range byIssuer[n] {
				relax(d.Audience, min(level, d.Power))
			}

			if n == subject {
				continue // Subject's members are what this evaluates.
			}

			var edges []sqliteEdge

			for e, err := range sqliteRows(ctx, tx, sqliteEdgesOf(), decodeSQLiteEdge, n) {
				if err != nil {
					return nil, err
				}

				edges = append(edges, e)
			}

			for _, e := range edges {
				relax(e.audience, min(level, e.power))
			}
		}
	}

	for _, d := range delegations {
		convey(d, min(d.Power, best[d.Issuer]))
	}

	return want, ctx.Err()
}

// writeEdges replaces subject's stored edges with want and returns the
// audiences whose edge changed.
func (tx Tx) writeEdges(ctx context.Context, subject keyline.Node, want map[keyline.Node]keyline.Power) ([]keyline.Node, error) {
	have := make(map[keyline.Node]keyline.Power)
	for row, err := range sqliteRows(ctx, tx, sqliteEdgesOf(), decodeSQLiteEdge, subject) {
		if err != nil {
			return nil, err
		}

		have[row.audience] = row.power
	}

	var changed []keyline.Node

	for _, audience := range slices.Sorted(maps.Keys(have)) {
		if _, ok := want[audience]; !ok {
			if err := sqlitex.Exec(tx.Conn, sqliteDeleteEdge(), nil, subject, audience); err != nil {
				return nil, err
			}

			changed = append(changed, audience)
		}
	}

	for _, audience := range slices.Sorted(maps.Keys(want)) {
		if have[audience] == want[audience] {
			continue
		}

		if err := sqlitex.Exec(tx.Conn, sqliteUpsertEdge(), nil, subject, audience, int(want[audience])); err != nil {
			return nil, err
		}

		changed = append(changed, audience)
	}

	return changed, nil
}

// Allows reports whether audience holds at least required over subject, as
// keyline.Allows does, answered from the stored edges instead of an
// evaluation. Invalid requirements, including None, are denied.
func (tx Tx) Allows(ctx context.Context, subject, audience keyline.Node, required keyline.Power) (bool, error) {
	if err := tx.active(ctx); err != nil {
		return false, err
	}

	if !required.Valid() || subject == "" || audience == "" {
		return false, nil
	}

	if subject == audience {
		return true, nil
	}

	reached, err := sqlitex.QueryOne[int](tx.Conn, sqliteReaches(), subject, audience, int(required))
	if err != nil {
		return false, err
	}

	return reached != 0, ctx.Err()
}

// StoredEdges returns subject's stored edges: for each audience, the strongest
// power subject's live delegations convey to it.
func (tx Tx) StoredEdges(ctx context.Context, subject keyline.Node) (map[keyline.Node]keyline.Power, error) {
	if err := tx.active(ctx); err != nil {
		return nil, err
	}

	out := make(map[keyline.Node]keyline.Power)
	for e, err := range sqliteRows(ctx, tx, sqliteEdgesOf(), decodeSQLiteEdge, subject) {
		if err != nil {
			return nil, err
		}

		out[e.audience] = e.power
	}

	return out, ctx.Err()
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
	return sqliteRows(ctx, tx, sqliteSubjects(), decodeSQLiteName)
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
	power, err := decodeSQLitePower(row, 4)
	if err != nil {
		return keyline.Delegation{}, err
	}

	d := keyline.Delegation{
		ID: keyline.ID(row.ColumnText(0)), Issuer: keyline.Node(row.ColumnText(1)), Audience: keyline.Node(row.ColumnText(2)),
		Subject: keyline.Node(row.ColumnText(3)), Power: power, BlobID: row.ColumnInt64(5),
	}

	// NULL is the only stored form of an implied delegation's zero BlobID.
	if row.ColumnType(5) != sqlite.SQLITE_NULL && d.BlobID <= 0 {
		return keyline.Delegation{}, fmt.Errorf("keyline: invalid SQLite delegation blob ID")
	}

	return d, d.Validate()
}

func decodeSQLiteName(row *sqlite.Stmt) (keyline.Node, error) {
	n := keyline.Node(row.ColumnText(0))
	if n == "" {
		return "", fmt.Errorf("keyline: invalid SQLite node name")
	}

	return n, nil
}

type sqliteEdge struct {
	audience keyline.Node
	power    keyline.Power
}

func decodeSQLiteEdge(row *sqlite.Stmt) (sqliteEdge, error) {
	audience, err := decodeSQLiteName(row)
	if err != nil {
		return sqliteEdge{}, err
	}

	power, err := decodeSQLitePower(row, 1)
	if err != nil {
		return sqliteEdge{}, err
	}

	return sqliteEdge{audience, power}, nil
}

// decodeSQLitePower reads a power stored as its keyline.Power number.
func decodeSQLitePower(row *sqlite.Stmt, col int) (keyline.Power, error) {
	n := row.ColumnInt64(col)
	if row.ColumnType(col) != sqlite.SQLITE_INTEGER || n < int64(keyline.Sync) || n > int64(keyline.Admin) {
		return keyline.None, fmt.Errorf("keyline: invalid SQLite power %q", row.ColumnText(col))
	}

	return keyline.Power(n), nil
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
