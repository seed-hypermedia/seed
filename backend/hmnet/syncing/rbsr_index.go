package syncing

import (
	"errors"
	"fmt"
	"seed/backend/blob"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/unsafeutil"
	"strconv"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/tidwall/gjson"
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

// qMaterializeReplace reads from the rbsr_blobs TEMP table (created by
// collectBlobs), so it is a plain const rather than a dqb.Str — dqb queries are
// validated against the schema-only DB by TestDBQueries, which has no temp
// tables. Same convention as the temp-table queries in discovery.go.
const qMaterializeReplace = `
	INSERT OR IGNORE INTO rbsr_item (scope, blob)
	SELECT :scope, rb.id
	FROM rbsr_blobs rb
	JOIN blobs b ON b.id = rb.id
	WHERE b.size >= 0;`

var qMaterializeClear = dqb.Str(`DELETE FROM rbsr_item WHERE scope = :scope;`)

var qMarkMaterialized = dqb.Str(`
	UPDATE rbsr_scope SET materialized = 1, last_access = :now WHERE id = :scope;`)

// materializeScope (re)builds a scope's persisted blob set from collectBlobs —
// the one place the expensive closure runs. Idempotent: it clears and refills
// the scope's rbsr_item rows, then marks it materialized.
func materializeScope(conn *sqlite.Conn, scopeID int64, dkey DiscoveryKey) error {
	if err := collectBlobs(conn, map[DiscoveryKey]struct{}{dkey: {}}, false); err != nil {
		return err
	}
	if err := sqlitex.Exec(conn, qMaterializeClear(), nil, scopeID); err != nil {
		return err
	}
	if err := sqlitex.Exec(conn, qMaterializeReplace, nil, scopeID); err != nil {
		return err
	}
	return sqlitex.Exec(conn, qMarkMaterialized(), nil, time.Now().Unix(), scopeID)
}

// qScopeItems mirrors loadRBSRStore's result query but sources the blob set from
// the persisted rbsr_item rows of the given scopes (a JSON array of scope ids)
// instead of rebuilding it via collectBlobs. DISTINCT collapses blobs shared
// across scopes so the single visibility index counts each unique blob once,
// matching loadRBSRStore's single-pass union over multiple discovery keys.
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
	WHERE b.size >= 0
	ORDER BY sb.ts, b.multihash;`)

// buildStoreFromScopes fills store from the union of the given scopes' persisted
// rbsr_item rows in a single ordered pass, applying per-item visibility — the
// same shape loadRBSRStore produces, but without re-running the closure. The
// store is not sealed here; the caller seals and filters it.
func buildStoreFromScopes(conn *sqlite.Conn, scopeIDs []int64, store *authorizedStore) (err error) {
	if len(scopeIDs) == 0 {
		return nil
	}

	idsJSON := make([]byte, 0, len(scopeIDs)*4+2)
	idsJSON = append(idsJSON, '[')
	for i, id := range scopeIDs {
		if i > 0 {
			idsJSON = append(idsJSON, ',')
		}
		idsJSON = strconv.AppendInt(idsJSON, id, 10)
	}
	idsJSON = append(idsJSON, ']')

	lookup := blob.NewLookupCache(conn)

	rows, discard, check := sqlitex.Query(conn, qScopeItems(), idsJSON).All()
	defer discard(&err)
	var i int
	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		var (
			ts             = row.ColumnInt64(inc())
			codec          = row.ColumnInt64(inc())
			hash           = row.ColumnBytesUnsafe(inc())
			visibilityJSON = row.ColumnTextUnsafe(inc())
		)

		c := cid.NewCidV1(uint64(codec), hash) //nolint:gosec
		if err := store.Insert(ts, unsafeutil.BytesFromString(c.KeyString())); err != nil {
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
			store.SetItemPrivateVisibility(i, space)
		}
		i++
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

var qInsertItem = dqb.Str(`INSERT OR IGNORE INTO rbsr_item (scope, blob) VALUES (:scope, :blob);`)

// MaintainRBSRIndex is the incremental maintenance hook: it patches the
// materialized scopes a freshly indexed batch of blobs joins, in the same
// indexing write transaction (so the patch commits atomically with the blobs).
// Registered on the index via SetIndexedHook.
//
// It mirrors every collectBlobs membership edge so the maintained set stays
// equal to a fresh materialization under live sync, not just the dominant
// document-edit path: (1) the resource-anchored forward seed/closure, (2) the
// late-arrival reverse edge for forward targets that arrived after their member,
// (3) inbound Contact-by-subject, and (4) the recursive agent-capability
// delegation closure. The shadow-verify sweep remains a backstop for anything
// these miss, but no longer carries the steady-state load.
func MaintainRBSRIndex(conn *sqlite.Conn, blobIDs []int64) error {
	keys, idsByKey, err := loadMaterializedScopes(conn)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}

	// touched tracks scopes whose member set changed this batch; the agent-
	// capability delegation closure is re-run for each at the end, because a new
	// member can be a blob authored by a capability's delegate — which pulls that
	// delegate's capabilities into the scope (and theirs, transitively).
	touched := map[int64]struct{}{}
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

	for _, blobID := range blobIDs {
		// (1) Forward seed: resource-anchored types plus their forward closure.
		inserts, _, err := affectedScopes(conn, blobID, keys)
		if err != nil {
			return err
		}
		for dkey, ids := range inserts {
			for _, scopeID := range idsByKey[dkey] {
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
				for _, bid := range closure {
					if err := insertItem(scopeID, bid); err != nil {
						return err
					}
				}
			}
		}
	}

	// (3) Attribute-keyed edges (Contact subject, Capability delegate): one pass
	// over the batch's structural facts.
	facts, err := structuralFactsForBatch(conn, blobIDs)
	if err != nil {
		return err
	}
	for _, f := range facts {
		switch {
		case f.typ == "Contact" && f.subject != 0:
			// Inbound Contact-by-subject: anchored to its creator's resource, but
			// belongs to the subject account's recursive scope.
			for _, scopeID := range rootBySubject[f.subject] {
				if err := insertItem(scopeID, f.id); err != nil {
					return err
				}
			}
		case f.typ == "Capability" && f.role == "AGENT" && f.del != 0:
			// A fresh AGENT capability joins any scope whose member its delegate
			// authored; mark those scopes so the closure below inserts it.
			ss, err := scopesWithAuthor(conn, f.del)
			if err != nil {
				return err
			}
			for _, scopeID := range ss {
				touched[scopeID] = struct{}{}
			}
		}
	}

	// (4) Agent-capability delegation closure for every touched scope, to a
	// fixpoint — the dominant edge the oracle previously deferred to shadow-verify.
	for scopeID := range touched {
		if err := runAgentCapClosure(conn, scopeID); err != nil {
			return err
		}
	}

	return nil
}

// structuralFact carries the batch-level attributes MaintainRBSRIndex keys on.
type structuralFact struct {
	id      int64
	typ     string
	subject int64 // extra_attrs->>'subject' (public_keys.id) for Contacts
	del     int64 // extra_attrs->>'del' (public_keys.id) for Capabilities
	role    string
}

var qStructuralFactsBatch = dqb.Str(`
	SELECT sb.id, sb.type,
		CAST(sb.extra_attrs->>'subject' AS INTEGER),
		CAST(sb.extra_attrs->>'del' AS INTEGER),
		sb.extra_attrs->>'role'
	FROM structural_blobs sb
	WHERE sb.id IN (SELECT value FROM json_each(:ids));`)

func structuralFactsForBatch(conn *sqlite.Conn, ids []int64) (out []structuralFact, err error) {
	if len(ids) == 0 {
		return nil, nil
	}
	err = sqlitex.Exec(conn, qStructuralFactsBatch(), func(stmt *sqlite.Stmt) error {
		out = append(out, structuralFact{
			id:      stmt.ColumnInt64(0),
			typ:     stmt.ColumnText(1),
			subject: stmt.ColumnInt64(2),
			del:     stmt.ColumnInt64(3),
			role:    stmt.ColumnText(4),
		})
		return nil
	}, int64SliceJSON(ids))
	return out, err
}

// int64SliceJSON renders ids as a JSON array for json_each binding.
func int64SliceJSON(ids []int64) []byte {
	b := make([]byte, 0, len(ids)*4+2)
	b = append(b, '[')
	for i, id := range ids {
		if i > 0 {
			b = append(b, ',')
		}
		b = strconv.AppendInt(b, id, 10)
	}
	return append(b, ']')
}
