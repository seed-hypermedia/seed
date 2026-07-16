package syncing

import (
	"context"
	"time"

	"seed/backend/blob"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"go.uber.org/zap"
)

// Shadow-verify is the safety net for the maintained index. The incremental
// oracle mirrors every collectBlobs membership edge, but a missed edge would
// silently leave a scope's set short — a blob that never propagates. So scopes
// are periodically recomputed the authoritative way (collectBlobs) and healed
// in place on any divergence.
//
// Design:
//   - Trickle, not full pass: each tick verifies one page of scopes (cursor
//     ordered by id, wrapping), bounding per-tick cost regardless of how many
//     scopes exist.
//   - Verification runs on a READ connection (collectBlobs writes TEMP tables
//     only), so clean scopes — the steady state — never touch the writer.
//   - Drift heals immediately via materializeScope in its own write tx, which
//     re-runs collectBlobs on the writer connection, so the heal is internally
//     consistent even if the set changed since the read-conn verify.
//   - A materialized=0 row (left by an interrupted materialization or an older
//     build's mark-stale) is drifted by definition and heals the same way, so
//     scopes can't rot outside both the oracle's and the sweep's view.
//   - Cold scopes (not accessed within shadowVerifyColdAfter) are skipped:
//     serve-time materialization already guarantees them a fresh set.
//   - A per-scope failure never aborts the pass.

const (
	// shadowVerifyTick is the cadence of one trickle batch.
	shadowVerifyTick = 30 * time.Second

	// shadowVerifyBatch is how many scopes one tick covers.
	shadowVerifyBatch = 25

	// shadowVerifyColdAfter is the access-recency horizon: scopes whose
	// last_access is older are skipped (rbsr_scope.last_access is set at
	// materialization time and refreshed by warm serves).
	shadowVerifyColdAfter = 72 * time.Hour

	// shadowVerifyEvictAfter, when non-zero, evicts scopes idle longer than
	// this (drops their rbsr_item rows and unmaterializes them) to bound the
	// table size and the oracle's per-batch fan-out. Deliberately disabled
	// until last_access has been serve-refreshed in production for longer
	// than the threshold — before that it still means "materialization time"
	// for old rows and eviction would fire en masse.
	shadowVerifyEvictAfter time.Duration = 0
)

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

// shadowVerifyScope recomputes the scope's set with collectBlobs and compares
// it to the maintained rbsr_item set. Read-only: collectBlobs writes TEMP
// tables only, so this runs on a read connection. Membership — not
// fingerprint — is compared, since canonicalization changes advertised codecs
// but never which blobs belong to a scope.
func shadowVerifyScope(conn *sqlite.Conn, scopeID int64, dkey DiscoveryKey) (drifted bool, err error) {
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

	return !blobSetsEqual(fresh, maintained), nil
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

var qScopePageAfter = dqb.Str(`
	SELECT id, iri, kind, materialized, last_access
	FROM rbsr_scope
	WHERE id > :cursor
	ORDER BY id
	LIMIT :limit;`)

type scopeRow struct {
	id           int64
	dkey         DiscoveryKey
	materialized bool
	lastAccess   int64
}

func listScopePage(conn *sqlite.Conn, cursor int64, limit int) (rows []scopeRow, err error) {
	if err := sqlitex.Exec(conn, qScopePageAfter(), func(stmt *sqlite.Stmt) error {
		rows = append(rows, scopeRow{
			id:           stmt.ColumnInt64(0),
			dkey:         dkeyForKind(blob.IRI(stmt.ColumnText(1)), scopeKind(stmt.ColumnInt64(2))),
			materialized: stmt.ColumnInt64(3) != 0,
			lastAccess:   stmt.ColumnInt64(4),
		})
		return nil
	}, cursor, int64(limit)); err != nil {
		return nil, err
	}
	return rows, nil
}

var qEvictScopeItems = dqb.Str(`DELETE FROM rbsr_item WHERE scope = :scope;`)

var qUnmarkMaterialized = dqb.Str(`UPDATE rbsr_scope SET materialized = 0 WHERE id = :scope;`)

// shadowVerifyStats aggregates one trickle tick's outcome.
type shadowVerifyStats struct {
	// checked counts materialized scopes actually verified against collectBlobs.
	checked int
	// drifted counts verified scopes whose maintained set diverged.
	drifted int
	// healed counts successful re-materializations (drifted + rotten scopes).
	healed int
	// failed counts scopes whose verify or heal errored (pass continued).
	failed int
	// skipped counts cold scopes (plus evicted ones, counted separately).
	skipped int
	// evicted counts scopes whose items were dropped for idleness.
	evicted int
}

// shadowVerifySweep runs one trickle tick: it pages up to limit scopes with
// id > cursor and verifies/heals them, returning the advanced cursor (0 when
// the page hit the end of the table, so the next tick wraps around).
// Verification happens per scope on a read connection; only healing and
// eviction take the writer, one scope per tx, so the sweep never holds the
// writer lock across scopes. A per-scope error is logged and counted, never
// fatal for the pass; the returned error is reserved for pass-level failures
// (paging, context cancellation).
func shadowVerifySweep(ctx context.Context, db *sqlitex.Pool, log *zap.Logger, cursor int64, limit int, now time.Time) (next int64, stats shadowVerifyStats, err error) {
	var page []scopeRow
	if err := db.WithSave(ctx, func(conn *sqlite.Conn) error {
		var e error
		page, e = listScopePage(conn, cursor, limit)
		return e
	}); err != nil {
		return cursor, stats, err
	}

	next = 0 // Short page → we've hit the end; wrap on the next tick.
	if len(page) == limit {
		next = page[len(page)-1].id
	}

	for _, s := range page {
		if ctx.Err() != nil {
			return next, stats, ctx.Err()
		}

		idle := shadowVerifyColdAfter + 1 // last_access == 0 → never accessed → cold.
		if s.lastAccess > 0 {
			idle = now.Sub(time.Unix(s.lastAccess, 0))
		}

		if shadowVerifyEvictAfter > 0 && s.materialized && idle > shadowVerifyEvictAfter {
			if err := db.WithTx(ctx, func(conn *sqlite.Conn) error {
				if err := sqlitex.Exec(conn, qEvictScopeItems(), nil, s.id); err != nil {
					return err
				}
				return sqlitex.Exec(conn, qUnmarkMaterialized(), nil, s.id)
			}); err != nil {
				stats.failed++
				log.Warn("ShadowVerifyEvictFailed", zap.Int64("scope", s.id), zap.String("iri", string(s.dkey.IRI)), zap.Error(err))
				continue
			}
			stats.evicted++
			continue
		}

		if idle > shadowVerifyColdAfter {
			// Cold: not worth the collectBlobs. If it's ever served again,
			// serve-time materialization produces a fresh set anyway.
			stats.skipped++
			continue
		}

		needsHeal := !s.materialized
		if s.materialized {
			var drifted bool
			verr := db.WithSaveTempOnly(ctx, func(conn *sqlite.Conn) error {
				var e error
				drifted, e = shadowVerifyScope(conn, s.id, s.dkey)
				return e
			})
			if verr != nil {
				stats.failed++
				log.Warn("ShadowVerifyScopeFailed", zap.Int64("scope", s.id), zap.String("iri", string(s.dkey.IRI)), zap.Error(verr))
				continue
			}
			stats.checked++
			if drifted {
				stats.drifted++
			}
			needsHeal = drifted
		}

		if !needsHeal {
			continue
		}

		if herr := db.WithTx(ctx, func(conn *sqlite.Conn) error {
			return materializeScope(conn, s.id, s.dkey)
		}); herr != nil {
			stats.failed++
			log.Warn("ShadowVerifyHealFailed", zap.Int64("scope", s.id), zap.String("iri", string(s.dkey.IRI)), zap.Error(herr))
			continue
		}
		stats.healed++
	}

	return next, stats, nil
}
