package syncing

import (
	"context"

	"seed/backend/blob"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Shadow-verify is the safety net for the maintained index. The incremental
// oracle covers the dominant edges but deliberately defers a few (inbound
// Contact-by-subject, capability delegation, late link targets) — a missed
// edge would silently leave a scope's set short, which means a blob that never
// propagates. So we periodically recompute a scope's set the authoritative way
// (collectBlobs) and compare it to the maintained set; any drift forces a
// re-materialization. This is what makes the deferred edges safe.

// qFreshScopeBlobs reads from the rbsr_blobs TEMP table (created by
// collectBlobs), so it is a plain const, not a dqb.Str — dqb queries are
// validated against the schema-only DB by TestDBQueries, which has no temp
// tables. Same convention as the temp-table queries in discovery.go.
const qFreshScopeBlobs = `
	SELECT rb.id
	FROM rbsr_blobs rb
	JOIN blobs b ON b.id = rb.id
	WHERE b.size >= 0;`

var qMaintainedScopeBlobs = dqb.Str(`SELECT blob FROM rbsr_item WHERE scope = :scope;`)

var qMarkStale = dqb.Str(`UPDATE rbsr_scope SET materialized = 0 WHERE id = :scope;`)

// shadowVerifyScope recomputes the scope's set with collectBlobs and compares it
// to the maintained rbsr_item set. On any difference it marks the scope for
// re-materialization (materialized = 0) and returns ok=false. Membership — not
// fingerprint — is compared, since canonicalization changes advertised codecs
// but never which blobs belong to a scope.
func shadowVerifyScope(conn *sqlite.Conn, scopeID int64, dkey DiscoveryKey) (ok bool, err error) {
	if err := collectBlobs(conn, map[DiscoveryKey]struct{}{dkey: {}}, false); err != nil {
		return false, err
	}

	fresh := map[int64]struct{}{}
	if err := sqlitex.Exec(conn, qFreshScopeBlobs, func(stmt *sqlite.Stmt) error {
		fresh[stmt.ColumnInt64(0)] = struct{}{}
		return nil
	}); err != nil {
		return false, err
	}

	maintained := map[int64]struct{}{}
	if err := sqlitex.Exec(conn, qMaintainedScopeBlobs(), func(stmt *sqlite.Stmt) error {
		maintained[stmt.ColumnInt64(0)] = struct{}{}
		return nil
	}, scopeID); err != nil {
		return false, err
	}

	if blobSetsEqual(fresh, maintained) {
		return true, nil
	}

	if err := sqlitex.Exec(conn, qMarkStale(), nil, scopeID); err != nil {
		return false, err
	}
	return false, nil
}

func blobSetsEqual(a, b map[int64]struct{}) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if _, ok := b[k]; !ok {
			return false
		}
	}
	return true
}

var qMaterializedScopesFull = dqb.Str(`
	SELECT id, iri, recursive, depth_one, blob_types FROM rbsr_scope WHERE materialized = 1;`)

type scopeRow struct {
	id   int64
	dkey DiscoveryKey
}

func listMaterializedScopeRows(conn *sqlite.Conn) (rows []scopeRow, err error) {
	if err := sqlitex.Exec(conn, qMaterializedScopesFull(), func(stmt *sqlite.Stmt) error {
		rows = append(rows, scopeRow{
			id: stmt.ColumnInt64(0),
			dkey: DiscoveryKey{
				IRI:       blob.IRI(stmt.ColumnText(1)),
				Recursive: stmt.ColumnInt64(2) != 0,
				DepthOne:  stmt.ColumnInt64(3) != 0,
				BlobTypes: stmt.ColumnText(4),
			},
		})
		return nil
	}); err != nil {
		return nil, err
	}
	return rows, nil
}

// ShadowVerifySweep runs shadow-verify across every materialized scope, each in
// its own write transaction so the sweep never holds the writer lock for the
// whole pass. Returns how many scopes were checked and how many drifted (and
// were marked for re-materialization). Driven by a periodic background loop.
func ShadowVerifySweep(ctx context.Context, db *sqlitex.Pool) (checked, drifted int, err error) {
	var scopes []scopeRow
	if err := db.WithSave(ctx, func(conn *sqlite.Conn) error {
		var e error
		scopes, e = listMaterializedScopeRows(conn)
		return e
	}); err != nil {
		return 0, 0, err
	}

	for _, s := range scopes {
		var ok bool
		if err := db.WithTx(ctx, func(conn *sqlite.Conn) error {
			var e error
			ok, e = shadowVerifyScope(conn, s.id, s.dkey)
			return e
		}); err != nil {
			return checked, drifted, err
		}
		checked++
		if !ok {
			drifted++
		}
	}
	return checked, drifted, nil
}
