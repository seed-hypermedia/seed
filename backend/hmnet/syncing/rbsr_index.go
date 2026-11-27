package syncing

import (
	"context"
	"errors"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/unsafeutil"
	"strconv"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

// This file is the persistence layer for the maintained RBSR index. A scope's
// resolved blob set (what collectBlobs produces) is stored in rbsr_item so the
// expensive closure runs once (materialization) instead of on every reconcile
// round. Serving builds a monoid-tree-backed store from those rows. The set is
// kept current incrementally by the oracle (see oracle.go / the index hook).

// scopeKind is the flattened identity of a reconciliation scope: it collapses
// the former (recursive, depth_one) flags and the blob-type allowlist into a
// single dimension, so each kind is a distinct scope rather than an orthogonal
// filter column. Anything we genuinely need a type filter for becomes its own
// kind (scopeDirStructure), keeping the schema one-dimensional.
type scopeKind int64

const (
	scopeExact        scopeKind = 0 // IRI only, no descent, no type filter.
	scopeDepthOne     scopeKind = 1 // direct children, no type filter.
	scopeRecursive    scopeKind = 2 // full subtree, no type filter.
	scopeDirStructure scopeKind = 3 // depth_one restricted to docStructureTypes.
)

// dirStructureTypes is the canonical BlobTypes string for the root-first
// directory pass, derived from docStructureTypes so the kind mapping can never
// drift from the source list. It is the single filtered scope kind.
var dirStructureTypes = BlobTypesString(docStructureTypes)

// errScopeNotRepresentable means a DiscoveryKey uses a filter combination the
// flattened scope model does not enumerate (an exotic blob-type allowlist, or
// the impossible recursive+depth_one pair). The caller falls back to the legacy
// non-indexed rebuild, which honors arbitrary filters.
var errScopeNotRepresentable = errors.New("discovery key has no maintained scope kind")

// errMaterializeRaced means the maintained index changed while a cold scope's
// blob set was being computed off the writer, so the computed set may miss
// blobs and was not persisted. The caller falls back to the legacy rebuild; the
// scope stays cold and the next load tries again.
var errMaterializeRaced = errors.New("maintained index changed while a scope was materializing")

// indexGeneration reads the database's count of applied index hook batches
// (see blob.BumpRBSRGeneration). A cold load reads it in the snapshot it
// computes a scope's set from, and again under the writer before persisting.
// The hook only patches materialized scopes, so a batch applied in between
// skipped the scope, and its blobs may be missing from the computed set.
func indexGeneration(conn *sqlite.Conn) (gen string, err error) {
	err = sqlitex.Exec(conn, qIndexGeneration(), func(stmt *sqlite.Stmt) error {
		gen = stmt.ColumnText(0)
		return nil
	}, blob.RBSRGenerationKey)
	return gen, err
}

var qIndexGeneration = dqb.Str(`SELECT value FROM kv WHERE key = :key;`)

// materializeSlot admits one cold materialization at a time, as the writer
// used to when the closure ran under it. Without it every concurrent discovery
// task would run its closure at once, each pinning a read connection for
// seconds and starving API reads of the pool.
var materializeSlot = make(chan struct{}, 1)

// scopeKindFor maps a DiscoveryKey to its persisted scope kind, or
// errScopeNotRepresentable when the key's filter isn't one the index maintains.
func scopeKindFor(dkey DiscoveryKey) (scopeKind, error) {
	if dkey.Recursive && dkey.DepthOne {
		return 0, errScopeNotRepresentable
	}
	switch dkey.BlobTypes {
	case "":
		switch {
		case dkey.Recursive:
			return scopeRecursive, nil
		case dkey.DepthOne:
			return scopeDepthOne, nil
		default:
			return scopeExact, nil
		}
	case dirStructureTypes:
		if dkey.DepthOne {
			return scopeDirStructure, nil
		}
	}
	return 0, errScopeNotRepresentable
}

// dkeyForKind reconstructs the DiscoveryKey a persisted scope row stands for, so
// the oracle's predicates (scopeCovers / scopeAllowsType) keep operating on a
// plain DiscoveryKey without ever learning about kinds.
func dkeyForKind(iri blob.IRI, k scopeKind) DiscoveryKey {
	switch k {
	case scopeDepthOne:
		return DiscoveryKey{IRI: iri, DepthOne: true}
	case scopeRecursive:
		return DiscoveryKey{IRI: iri, Recursive: true}
	case scopeDirStructure:
		return DiscoveryKey{IRI: iri, DepthOne: true, BlobTypes: dirStructureTypes}
	default: // scopeExact
		return DiscoveryKey{IRI: iri}
	}
}

var qLookupScope = dqb.Str(`
	SELECT id, materialized, last_access
	FROM rbsr_scope
	WHERE iri = :iri AND kind = :kind;`)

// scopeLookup is lookupScope's result: the scope row's state, or found=false
// when no row exists for the key yet.
type scopeLookup struct {
	id           int64
	materialized bool
	found        bool
	lastAccess   int64
}

// lookupScope is the read-only half of resolveScope: it maps a discovery key
// to its persisted scope row without creating one, so warm serves can run
// entirely on a read connection. Returns errScopeNotRepresentable exactly like
// resolveScope for keys the flattened index doesn't maintain.
func lookupScope(conn *sqlite.Conn, dkey DiscoveryKey) (l scopeLookup, err error) {
	kind, err := scopeKindFor(dkey)
	if err != nil {
		return l, err
	}
	if err := sqlitex.Exec(conn, qLookupScope(), func(stmt *sqlite.Stmt) error {
		l.found = true
		l.id = stmt.ColumnInt64(0)
		l.materialized = stmt.ColumnInt64(1) != 0
		l.lastAccess = stmt.ColumnInt64(2)
		return nil
	}, string(dkey.IRI), int64(kind)); err != nil {
		return scopeLookup{}, err
	}
	return l, nil
}

var qCountMaterializedIn = dqb.Str(`
	SELECT COUNT(*) FROM rbsr_scope
	WHERE materialized = 1
	AND id IN (SELECT value FROM json_each(:ids));`)

// countMaterialized reports how many of the given scope ids currently have a
// materialized row — the serve path's guard against a full reindex dropping
// the derived tables between its read and write phases.
func countMaterialized(conn *sqlite.Conn, ids []int64) (int, error) {
	var n int
	err := sqlitex.Exec(conn, qCountMaterializedIn(), func(stmt *sqlite.Stmt) error {
		n = stmt.ColumnInt(0)
		return nil
	}, int64SliceJSON(ids))
	return n, err
}

var qTouchScopes = dqb.Str(`
	UPDATE rbsr_scope SET last_access = :now
	WHERE id IN (SELECT value FROM json_each(:ids));`)

// lastAccessRefreshInterval bounds how often a warm scope load pays a
// (best-effort, off-path) write to refresh rbsr_scope.last_access — hour
// resolution is plenty for the sweep's cold-skip/eviction horizons at
// negligible writer cost.
const lastAccessRefreshInterval = time.Hour

// loadIndexedScopes is the maintained-index load shared by the serve path and
// the client store build. It runs in three phases so the steady state — every
// requested scope already materialized — happens entirely on read connections
// and never contends with the persist feeder for the writer:
//
//  1. read: map discovery keys to scope rows (lookupScope);
//  2. only when some scope is missing or unmaterialized: compute those
//     scopes' sets on a read connection — the one place the expensive
//     collectBlobs closure runs — then take the writer just to persist them
//     and fill the store on that same connection, so the freshly committed
//     rows are guaranteed visible. The closure must not run under the writer:
//     it takes seconds on a large permission graph, and every local write
//     (publishing a document, posting a comment) queued behind it;
//  3. read (all-warm case only): fill store from the persisted rows, after
//     re-checking the scopes are still materialized (a full reindex may drop
//     the derived tables between phases; the miss surfaces as an error and the
//     caller falls back to the legacy rebuild).
//
// It returns the scope ids whose last_access is due a refresh; the caller
// passes them to touchScopesAsync off the latency path. The store is filled
// but not sealed.
func loadIndexedScopes(ctx context.Context, db *sqlitex.Pool, dkeys colx.HashSet[DiscoveryKey], store *authorizedStore) (refresh []int64, err error) {
	var (
		scopeIDs = make([]int64, 0, len(dkeys))
		cold     []DiscoveryKey
	)
	if err := db.WithSave(ctx, func(conn *sqlite.Conn) error {
		for dkey := range dkeys {
			// lookupScope returns errScopeNotRepresentable for an exotic
			// blob-type filter the flattened index doesn't maintain; it
			// propagates so the caller falls back to the legacy rebuild, which
			// honors arbitrary filters.
			l, err := lookupScope(conn, dkey)
			if err != nil {
				return err
			}
			if !l.found || !l.materialized {
				cold = append(cold, dkey)
				continue
			}
			scopeIDs = append(scopeIDs, l.id)
			if time.Since(time.Unix(l.lastAccess, 0)) > lastAccessRefreshInterval {
				refresh = append(refresh, l.id)
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	// buildFinal re-checks the scopes are still materialized (a full reindex
	// may drop the derived tables between phases; the miss surfaces as an
	// error and the caller falls back to the legacy rebuild) and fills the
	// store from the persisted rows.
	buildFinal := func(conn *sqlite.Conn) error {
		n, err := countMaterialized(conn, scopeIDs)
		if err != nil {
			return err
		}
		if n != len(scopeIDs) {
			return fmt.Errorf("%d of %d scopes lost materialization mid-load (reindex in flight?): scopes=%v", len(scopeIDs)-n, len(scopeIDs), scopeIDs)
		}
		return buildStoreFromScopes(conn, scopeIDs, store)
	}

	if len(cold) > 0 {
		select {
		case materializeSlot <- struct{}{}:
		case <-ctx.Done():
			return nil, ctx.Err()
		}

		defer func() { <-materializeSlot }()

		computed, err := collectColdScopes(ctx, db, cold)
		if err != nil {
			return nil, err
		}

		// Persist AND build on the same writer connection: a fresh read
		// connection's snapshot may predate the materializing commit, which
		// used to fail the phase-3 re-check every time for these scopes —
		// a permanent serve fallback that also starved last_access refreshes
		// until the sweep's cold-skip horizon disowned the scope entirely.
		if err := db.WithTx(ctx, func(conn *sqlite.Conn) error {
			ids, err := persistColdScopes(conn, cold, computed)
			if err != nil {
				return err
			}
			scopeIDs = append(scopeIDs, ids...)
			return buildFinal(conn)
		}); err != nil {
			return nil, err
		}
		return refresh, nil
	}

	if err := db.WithSave(ctx, buildFinal); err != nil {
		return nil, err
	}

	return refresh, nil
}

// coldScopes is what collectColdScopes computed off the writer: each cold
// scope's blob set, and the index generation of the snapshot they came from.
type coldScopes struct {
	gen  string
	sets map[DiscoveryKey][]int64
}

// collectColdScopes computes the blob sets of cold scopes on a read
// connection, in one snapshot. Scopes a concurrent load materialized in the
// meantime are left out.
func collectColdScopes(ctx context.Context, db *sqlitex.Pool, cold []DiscoveryKey) (out coldScopes, err error) {
	out.sets = make(map[DiscoveryKey][]int64, len(cold))
	err = db.WithSaveTempOnly(ctx, func(conn *sqlite.Conn) (err error) {
		if out.gen, err = indexGeneration(conn); err != nil {
			return err
		}

		for _, dkey := range cold {
			l, err := lookupScope(conn, dkey)
			if err != nil {
				return err
			}

			if l.found && l.materialized {
				continue
			}

			ids, err := collectScopeBlobs(conn, dkey)
			if err != nil {
				return err
			}

			out.sets[dkey] = ids
		}

		return nil
	})
	return out, err
}

// persistColdScopes stores the computed sets under the writer and returns the
// scopes' row ids. It returns errMaterializeRaced, storing nothing the caller
// should keep, when the index changed after the sets were computed.
func persistColdScopes(conn *sqlite.Conn, cold []DiscoveryKey, computed coldScopes) (scopeIDs []int64, err error) {
	gen, err := indexGeneration(conn)
	if err != nil {
		return nil, err
	}

	if gen != computed.gen {
		return nil, errMaterializeRaced
	}

	for _, dkey := range cold {
		id, materialized, err := resolveScope(conn, dkey)
		if err != nil {
			return nil, err
		}

		if !materialized {
			ids, ok := computed.sets[dkey]
			if !ok {
				// Warm in the snapshot, demoted since: nothing was computed
				// for it.
				return nil, errMaterializeRaced
			}

			if err := storeScopeItems(conn, id, ids); err != nil {
				return nil, err
			}
		}

		scopeIDs = append(scopeIDs, id)
	}

	return scopeIDs, nil
}

// touchScopesAsync best-effort-bumps last_access for the given scopes so the
// shadow-verify trickle keeps treating actively used scopes as warm. Runs off
// the caller's latency path; a dropped update only delays the hour-resolution
// refresh, so errors are logged at Debug and swallowed.
func touchScopesAsync(db *sqlitex.Pool, log *zap.Logger, ids []int64) {
	if len(ids) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := db.WithTx(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, qTouchScopes(), nil, time.Now().Unix(), int64SliceJSON(ids))
		}); err != nil {
			log.Debug("RBSRScopeTouchFailed", zap.Error(err))
		}
	}()
}

var qResolveScopeInsert = dqb.Str(`
	INSERT OR IGNORE INTO rbsr_scope (iri, kind)
	VALUES (:iri, :kind);`)

var qResolveScopeSelect = dqb.Str(`
	SELECT id, materialized
	FROM rbsr_scope
	WHERE iri = :iri AND kind = :kind;`)

// resolveScope returns the rbsr_scope row id for the given discovery key,
// creating an unmaterialized row if absent. It returns errScopeNotRepresentable
// when the key has no maintained scope kind, so the caller falls back to the
// legacy rebuild.
func resolveScope(conn *sqlite.Conn, dkey DiscoveryKey) (id int64, materialized bool, err error) {
	kind, err := scopeKindFor(dkey)
	if err != nil {
		return 0, false, err
	}
	args := []any{string(dkey.IRI), int64(kind)}
	if err := sqlitex.Exec(conn, qResolveScopeInsert(), nil, args...); err != nil {
		return 0, false, err
	}
	var found bool
	if err := sqlitex.Exec(conn, qResolveScopeSelect(), func(stmt *sqlite.Stmt) error {
		found = true
		id = stmt.ColumnInt64(0)
		materialized = stmt.ColumnInt64(1) != 0
		return nil
	}, args...); err != nil {
		return 0, false, err
	}
	if !found {
		return 0, false, fmt.Errorf("BUG: rbsr_scope row missing after insert")
	}
	return id, materialized, nil
}

// qCollectedBlobs reads from the rbsr_blobs TEMP table (created by
// collectBlobs), so it is a plain const rather than a dqb.Str — dqb queries are
// validated against the schema-only DB by TestDBQueries, which has no temp
// tables. Same convention as the temp-table queries in discovery.go.
const qCollectedBlobs = `
	SELECT rb.id
	FROM rbsr_blobs rb
	JOIN blobs b INDEXED BY blobs_metadata ON b.id = rb.id
	WHERE b.size >= 0;`

// qMaterializeInsert re-checks size >= 0 under the writer, so the rbsr_item
// membership contract (downloaded blobs only) holds whatever the caller
// computed.
var qMaterializeInsert = dqb.Str(`
	INSERT OR IGNORE INTO rbsr_item (scope, blob)
	SELECT :scope, b.id
	FROM json_each(:ids) j
	JOIN blobs b INDEXED BY blobs_metadata ON b.id = j.value
	WHERE b.size >= 0;`)

var qMaterializeClear = dqb.Str(`DELETE FROM rbsr_item WHERE scope = :scope;`)

var qMarkMaterialized = dqb.Str(`
	UPDATE rbsr_scope SET materialized = 1, last_access = :now WHERE id = :scope;`)

// collectScopeBlobs computes a scope's blob set from collectBlobs — the one
// place the expensive closure runs. It writes only TEMP tables, so it runs on
// a read connection.
func collectScopeBlobs(conn *sqlite.Conn, dkey DiscoveryKey) ([]int64, error) {
	if err := collectBlobs(conn, map[DiscoveryKey]struct{}{dkey: {}}, false); err != nil {
		return nil, err
	}
	ids := []int64{}

	if err := sqlitex.Exec(conn, qCollectedBlobs, func(stmt *sqlite.Stmt) error {
		ids = append(ids, stmt.ColumnInt64(0))
		return nil
	}); err != nil {
		return nil, err
	}

	return ids, nil
}

// storeScopeItems replaces a scope's persisted blob set with ids and marks it
// materialized. Idempotent, and short enough to run under the writer.
func storeScopeItems(conn *sqlite.Conn, scopeID int64, ids []int64) error {
	if err := sqlitex.Exec(conn, qMaterializeClear(), nil, scopeID); err != nil {
		return err
	}

	if err := sqlitex.Exec(conn, qMaterializeInsert(), nil, scopeID, int64SliceJSON(ids)); err != nil {
		return err
	}
	return sqlitex.Exec(conn, qMarkMaterialized(), nil, time.Now().Unix(), scopeID)
}

// materializeScope (re)builds a scope's persisted blob set on one connection.
// It holds the writer through the closure, so it is for the shadow-verify heal
// and tests only; serving goes through loadIndexedScopes, which computes the
// set off the writer.
func materializeScope(conn *sqlite.Conn, scopeID int64, dkey DiscoveryKey) error {
	ids, err := collectScopeBlobs(conn, dkey)
	if err != nil {
		return err
	}

	return storeScopeItems(conn, scopeID, ids)
}

// qScopeItems mirrors loadRBSRStore's result query but sources the blob set from
// the persisted rbsr_item rows of the given scopes (a JSON array of scope ids)
// instead of rebuilding it via collectBlobs. DISTINCT collapses blobs shared
// across scopes, matching loadRBSRStore's single-pass union over multiple
// discovery keys. Rows come unordered: both stores order items themselves and
// visibility is attached by value, so a sort here would only cost a temp
// b-tree per reconcile round (22% of the query on a 60k-blob scope).
var qScopeItems = dqb.Str(`SELECT
		COALESCE(sb.ts, 0),
		b.codec,
		b.multihash,
		CASE
			WHEN EXISTS (
				SELECT 1 FROM blob_visibility
				WHERE id = b.id AND space = 0
			) THEN '[0]'
			ELSE (
				SELECT JSON_GROUP_ARRAY(space)
				FROM blob_visibility
				WHERE id = b.id
			)
		END
	FROM (SELECT DISTINCT blob FROM rbsr_item WHERE scope IN (SELECT value FROM json_each(:ids))) ri
	CROSS JOIN blobs b INDEXED BY blobs_metadata ON b.id = ri.blob
	LEFT JOIN structural_blobs sb ON sb.id = b.id
	WHERE b.size >= 0;`)

// buildStoreFromScopes fills store from the union of the given scopes' persisted
// rbsr_item rows in a single pass, applying per-item visibility — the same
// shape loadRBSRStore produces, but without re-running the closure. The store
// is not sealed here; the caller seals and filters it.
func buildStoreFromScopes(conn *sqlite.Conn, scopeIDs []int64, store *authorizedStore) (err error) {
	if len(scopeIDs) == 0 {
		return nil
	}

	lookup := blob.NewLookupCache(conn)

	// int64SliceJSON returns a string so :ids binds as TEXT — a []byte would bind
	// as a BLOB, which SQLite (>=3.45) reads as JSONB and rejects as malformed.
	rows, discard, check := sqlitex.Query(conn, qScopeItems(), int64SliceJSON(scopeIDs)).All()
	defer discard(&err)
	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		var (
			ts             = row.ColumnInt64(inc())
			codec          = row.ColumnInt64(inc())
			hash           = row.ColumnBytesUnsafe(inc())
			visibilityJSON = row.ColumnTextUnsafe(inc())
		)

		c := cid.NewCidV1(uint64(codec), hash) //nolint:gosec

		key := c.KeyString()
		if err := store.Insert(ts, unsafeutil.BytesFromString(key)); err != nil {
			return fmt.Errorf("failed to insert blob %s into RBSR store: %w", c, err)
		}

		for _, v := range gjson.Parse(visibilityJSON).ForEach {
			vv := v.Int()
			if vv == 0 {
				break
			}
			space, err := lookup.PublicKey(vv)
			if err != nil {
				return err
			}
			store.SetItemPrivateVisibility(key, space)
		}
	}

	if err := check(); err != nil {
		return err
	}
	return nil
}

var qMaterializedScopes = dqb.Str(`
	SELECT id, iri, kind FROM rbsr_scope WHERE materialized = 1;`)

// loadMaterializedScopes returns the discovery keys of all materialized scopes
// plus, for each key, its scope-row id. With the flattened schema a key maps to
// exactly one row ((iri, kind) is UNIQUE), so each idsByKey slice holds a single
// id; the slice shape is kept so the oracle's fan-out loops read unchanged.
func loadMaterializedScopes(conn *sqlite.Conn) (keys []DiscoveryKey, idsByKey map[DiscoveryKey][]int64, err error) {
	idsByKey = make(map[DiscoveryKey][]int64)
	if err := sqlitex.Exec(conn, qMaterializedScopes(), func(stmt *sqlite.Stmt) error {
		id := stmt.ColumnInt64(0)
		key := dkeyForKind(blob.IRI(stmt.ColumnText(1)), scopeKind(stmt.ColumnInt64(2)))
		if _, seen := idsByKey[key]; !seen {
			keys = append(keys, key)
		}
		idsByKey[key] = append(idsByKey[key], id)
		return nil
	}); err != nil {
		return nil, nil, err
	}
	return keys, idsByKey, nil
}

// qInsertItem is the single write point for incremental oracle inserts. The
// size >= 0 guard enforces the rbsr_item membership contract (downloaded blobs
// only) no matter what a future caller feeds it; an undownloaded blob inserts
// zero rows, so insertItem's Changes()-based touch tracking stays accurate.
var qInsertItem = dqb.Str(`
	INSERT OR IGNORE INTO rbsr_item (scope, blob)
	SELECT :scope, :blob
	WHERE EXISTS (SELECT 1 FROM blobs b WHERE b.id = :blob AND b.size >= 0);`)

// qStaleMarkAllScopes is the incremental oracle's fail-safe: when a batch
// contains a membership edge MaintainRBSRIndex does not mirror, every
// materialized scope is demoted so the next serve re-materializes it from
// collectBlobs. See the incomplete-tracking in MaintainRBSRIndex.
var qStaleMarkAllScopes = dqb.Str(`
	UPDATE rbsr_scope SET materialized = 0 WHERE materialized = 1;`)

// MaintainRBSRIndex is the incremental maintenance hook: it patches the
// materialized scopes a freshly indexed batch of blobs joins. Registered on
// the index via SetIndexedHook, which applies it asynchronously in short
// standalone write transactions shortly after the blobs commit, so this work
// never extends foreground writes (comment posts, sync batches).
//
// It mirrors every collectBlobs membership edge so the maintained set stays
// equal to a fresh materialization under live sync, not just the dominant
// document-edit path: (1) the resource-anchored forward seed/closure, (2) the
// late-arrival reverse edge for forward targets that arrived after their member,
// (3) inbound Contact-by-subject, (4) resource authority dependencies, and (5)
// the recursive author-based agent-capability closure. Capability batches demote
// the materialized scopes instead, because their authority effects can cross
// resource boundaries; ordinary document edits remain incremental.
func MaintainRBSRIndex(conn *sqlite.Conn, blobIDs []int64) error {
	// Before anything else: a cold load computing a scope off the writer must
	// see that this batch was applied without it. See indexGeneration.
	if err := blob.BumpRBSRGeneration(conn); err != nil {
		return err
	}

	keys, idsByKey, err := loadMaterializedScopes(conn)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}

	facts, err := structuralFactsForBatch(conn, blobIDs)
	if err != nil {
		return err
	}

	// A capability can change the authority proofs of resources it doesn't
	// name: it covers a whole path, and AGENT chains connect it to whatever its
	// delegates write. Finding the affected scopes exactly would mean
	// re-collecting all of them, which held the writer for seconds per batch.
	// Demote them instead, so each re-materializes from collectBlobs on its
	// next serve, the same way a scope that was never materialized does.
	for _, f := range facts {
		if f.typ == "Capability" {
			return sqlitex.Exec(conn, qStaleMarkAllScopes(), nil)
		}
	}

	// Reverse map for per-scope allowlist checks: SQL-driven edges below
	// (scopesWithAuthor, scopesLinkingTo) return bare scope ids, but the
	// author-based capability closure honors the scope's blob-type filter.
	dkeyByScope := make(map[int64]DiscoveryKey, len(keys))
	for dkey, ids := range idsByKey {
		for _, id := range ids {
			dkeyByScope[id] = dkey
		}
	}

	// touched tracks scopes whose member set changed this batch; the agent-
	// capability delegation closure is re-run for each at the end, because a new
	// member can be a blob authored by a capability's delegate — which pulls that
	// delegate's capabilities into the scope (and theirs, transitively).
	touched := map[int64]struct{}{}
	// Record ordinary selections even when they are already scope members via
	// authority. Authority-only additions must not expand their own anchors.
	selectedByScope := map[int64][]int64{}
	insertItem := func(scopeID, blobID int64) error {
		if err := sqlitex.Exec(conn, qInsertItem(), nil, scopeID, blobID); err != nil {
			return err
		}
		if conn.Changes() > 0 {
			touched[scopeID] = struct{}{}
		}
		return nil
	}

	// Recursive account-root scopes keyed by their account's public-key id, for
	// the inbound Contact-by-subject edge below.
	rootBySubject, err := rootScopesBySubject(conn, keys, idsByKey)
	if err != nil {
		return err
	}

	// Scopes keyed by their bare IRI, for the comment-TSID edge below:
	// fillTables seeds any scope whose requested IRI is itself a state-based
	// resource path (hm://author/tsid) with every blob carrying that tsid by
	// that author, regardless of scope kind or type filter, so the edge matches
	// on IRI equality alone.
	scopesByIRI := make(map[blob.IRI][]int64, len(keys))
	for _, k := range keys {
		scopesByIRI[k.IRI] = append(scopesByIRI[k.IRI], idsByKey[k]...)
	}

	// incomplete tracks blobs whose affectedScopes result is partial: blobs that
	// can enter scopes through edges that are not a forward link-walk. Each
	// targeted edge below deletes the cases it provably covers; anything left
	// at the end is a case this function does not understand, and the affected
	// scopes are stale-marked so the next serve re-materializes them from
	// collectBlobs instead of silently under-advertising. Today the leftover
	// set is empty — this is the contract enforcement that keeps it that way
	// when the oracle and this function drift apart in the future.
	incomplete := make(map[int64]struct{})

	for _, blobID := range blobIDs {
		// (1) Forward seed: resource-anchored types plus their forward closure.
		inserts, complete, err := affectedScopes(conn, blobID, keys)
		if err != nil {
			return err
		}
		if !complete {
			incomplete[blobID] = struct{}{}
		}
		for dkey, ids := range inserts {
			for _, scopeID := range idsByKey[dkey] {
				selectedByScope[scopeID] = append(selectedByScope[scopeID], ids...)
				for _, bid := range ids {
					if err := insertItem(scopeID, bid); err != nil {
						return err
					}
				}
			}
		}

		// (2) Late-arrival reverse edge: a forward target (a Change, media blob, …)
		// that arrived after the member whose closure should have pulled it in. If
		// any existing scope member links to it, it — and its own forward closure,
		// now indexable — belongs to that scope.
		lateScopes, err := scopesLinkingTo(conn, blobID)
		if err != nil {
			return err
		}
		if len(lateScopes) > 0 {
			closure, err := forwardClosureDownloaded(conn, blobID)
			if err != nil {
				return err
			}
			for _, scopeID := range lateScopes {
				selectedByScope[scopeID] = append(selectedByScope[scopeID], closure...)
				for _, bid := range closure {
					if err := insertItem(scopeID, bid); err != nil {
						return err
					}
				}
			}
		}
	}

	// (3) Attribute-keyed edges (comment TSID, Contact subject): one pass over
	// the batch's structural facts. Capability batches returned above.
	for _, f := range facts {
		// Comment-TSID edge (independent of the type-keyed edges below): a
		// state-based resource blob (a comment, or an edit of one — edits share
		// the TSID) belongs to any scope addressed by the resource's own IRI.
		// The IRI construction must byte-match the fillTables TSID seed and the
		// comment IRIs produced at discovery time (hm://<author>/<tsid>).
		if f.tsid != "" && len(f.authority) > 0 {
			if scopes := scopesByIRI[blob.IRI("hm://"+core.Principal(f.authority).String()+"/"+f.tsid)]; len(scopes) > 0 {
				// The blob's downloaded forward closure rides along, mirroring
				// the media walk collectBlobs runs from the tsid seed (reply
				// parents' media, target-version changes, embedded files).
				closure, err := forwardClosureDownloaded(conn, f.id)
				if err != nil {
					return err
				}
				for _, scopeID := range scopes {
					selectedByScope[scopeID] = append(selectedByScope[scopeID], closure...)
					for _, bid := range closure {
						if err := insertItem(scopeID, bid); err != nil {
							return err
						}
					}
				}
			}
		}

		switch {
		case f.typ == "Contact":
			// Inbound Contact-by-subject: anchored to its creator's resource, but
			// belongs to the subject account's recursive scope. This edge is the
			// only non-forward path a Contact takes into a scope, so together
			// with the resource-anchored seed it fully covers the blob — and a
			// Contact without a subject cannot take the edge at all.
			delete(incomplete, f.id)
			if f.subject != 0 {
				for _, scopeID := range rootBySubject[f.subject] {
					selectedByScope[scopeID] = append(selectedByScope[scopeID], f.id)
					if err := insertItem(scopeID, f.id); err != nil {
						return err
					}
				}
			}
		}
	}

	// Non-structural blobs (Raw/DagPB) reported incomplete are covered by the
	// late-arrival reverse edge (2): they are only ever scope members through
	// the media closure of a structural member linking to them, and edge (2)
	// walked exactly those inbound links. They have no structural fact row, so
	// consume them by elimination.
	if len(incomplete) > 0 {
		structural := make(map[int64]struct{}, len(facts))
		for _, f := range facts {
			structural[f.id] = struct{}{}
		}
		for id := range incomplete {
			if _, ok := structural[id]; !ok {
				delete(incomplete, id)
			}
		}
	}

	// Fail-safe: anything still incomplete is a membership edge this function
	// does not mirror (a future blob type, a future collectBlobs edge). The
	// resource-anchored inserts above are still sound, but a scope may be owed
	// more — so stale-mark every materialized scope and let the next serve
	// re-materialize from collectBlobs. Deliberately coarse: this branch is
	// never expected to execute, and silent under-advertisement is the failure
	// mode that cost us synced write capabilities, so correctness wins over
	// precision here.
	if len(incomplete) > 0 {
		MRBSRIndexStaleMarks.Add(float64(len(incomplete)))
		if err := sqlitex.Exec(conn, qStaleMarkAllScopes(), nil); err != nil {
			return err
		}
	}

	// (4) New resources and newly selected forward targets bring their authority
	// dependencies even when the scope's type filter excludes Capability. Gather
	// all resource identities first, then evaluate each once across this batch.
	resourceScopes := map[blob.IRI]map[int64]struct{}{}
	addResource := func(resource blob.IRI, scopeID int64) {
		if resourceScopes[resource] == nil {
			resourceScopes[resource] = map[int64]struct{}{}
		}

		resourceScopes[resource][scopeID] = struct{}{}
	}
	for _, f := range facts {
		if f.resource == "" {
			continue
		}

		for key, ids := range idsByKey {
			if scopeCovers(key, f.resource) {
				for _, id := range ids {
					addResource(f.resource, id)
				}
			}
		}
	}

	var selectedIDs []int64

	for _, ids := range selectedByScope {
		selectedIDs = append(selectedIDs, ids...)
	}

	selectedFacts, err := structuralFactsForBatch(conn, selectedIDs)
	if err != nil {
		return err
	}

	resourcesByBlob := make(map[int64]blob.IRI, len(selectedFacts))
	for _, f := range selectedFacts {
		resourcesByBlob[f.id] = f.resource
	}

	for scopeID, ids := range selectedByScope {
		for _, id := range ids {
			if resource := resourcesByBlob[id]; resource != "" {
				addResource(resource, scopeID)
			}
		}
	}

	for resource, scopes := range resourceScopes {
		ids, err := blob.AuthorityBlobIDs(context.Background(), conn, resource)
		if err != nil {
			return err
		}

		for scopeID := range scopes {
			for _, id := range ids {
				if err := insertItem(scopeID, id); err != nil {
					return err
				}
			}
		}
	}

	// (5) Preserve the author-based AGENT closure for signers that need not be
	// members of a resource. This optional material follows the type filter;
	// resource authority dependencies above do not.
	for scopeID := range touched {
		dk, ok := dkeyByScope[scopeID]
		if !ok || !scopeAllowsType(dk, "Capability") {
			continue
		}
		if err := runAgentCapClosure(conn, scopeID); err != nil {
			return err
		}
	}

	return nil
}

// structuralFact carries the batch-level attributes MaintainRBSRIndex keys on.
type structuralFact struct {
	id        int64
	typ       string
	subject   int64 // extra_attrs->>'subject' (public_keys.id) for Contacts
	del       int64 // extra_attrs->>'del' (public_keys.id) for Capabilities
	role      string
	tsid      string // extra_attrs->>'tsid' for state-based resources (Comments et al.)
	authority []byte // record authority principal bytes, for the tsid-scope IRI
	resource  blob.IRI
}

var qStructuralFactsBatch = dqb.Str(`
	SELECT sb.id, sb.type,
		CAST(sb.extra_attrs->>'subject' AS INTEGER),
		CAST(sb.extra_attrs->>'del' AS INTEGER),
		sb.extra_attrs->>'role',
		COALESCE(sb.extra_attrs->>'tsid', ''),
		pk.principal,
		COALESCE(r.iri, '')
	FROM structural_blobs sb
	LEFT JOIN public_keys pk ON pk.id = COALESCE(sb.extra_attrs->>'account', sb.author)
	LEFT JOIN resources r ON r.id = sb.resource
	WHERE sb.id IN (SELECT value FROM json_each(:ids));`)

func structuralFactsForBatch(conn *sqlite.Conn, ids []int64) (out []structuralFact, err error) {
	if len(ids) == 0 {
		return nil, nil
	}
	err = sqlitex.Exec(conn, qStructuralFactsBatch(), func(stmt *sqlite.Stmt) error {
		out = append(out, structuralFact{
			id:        stmt.ColumnInt64(0),
			typ:       stmt.ColumnText(1),
			subject:   stmt.ColumnInt64(2),
			del:       stmt.ColumnInt64(3),
			role:      stmt.ColumnText(4),
			tsid:      stmt.ColumnText(5),
			authority: stmt.ColumnBytes(6),
			resource:  blob.IRI(stmt.ColumnText(7)),
		})
		return nil
	}, int64SliceJSON(ids))
	return out, err
}

// int64SliceJSON renders ids as a JSON array for json_each binding. It returns a
// string (not []byte) so the driver binds it as TEXT: SQLite (>=3.45) interprets
// a BLOB argument to json_each as JSONB, so a []byte would be mis-read as binary
// JSON and fail with "malformed JSON".
func int64SliceJSON(ids []int64) string {
	b := make([]byte, 0, len(ids)*4+2)
	b = append(b, '[')
	for i, id := range ids {
		if i > 0 {
			b = append(b, ',')
		}
		b = strconv.AppendInt(b, id, 10)
	}
	b = append(b, ']')
	return unsafeutil.StringFromBytes(b)
}
