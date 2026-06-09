package syncing

import (
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

func boolToInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

var qResolveScopeInsert = dqb.Str(`
	INSERT OR IGNORE INTO rbsr_scope (iri, recursive, depth_one, blob_types, protocol_version)
	VALUES (:iri, :recursive, :depth_one, :blob_types, :protocol_version);`)

var qResolveScopeSelect = dqb.Str(`
	SELECT id, materialized
	FROM rbsr_scope
	WHERE iri = :iri AND recursive = :recursive AND depth_one = :depth_one
		AND blob_types = :blob_types AND protocol_version = :protocol_version;`)

// resolveScope returns the rbsr_scope row id for the given discovery key and
// protocol version, creating an unmaterialized row if absent.
func resolveScope(conn *sqlite.Conn, dkey DiscoveryKey, protocolVersion string) (id int64, materialized bool, err error) {
	args := []any{
		string(dkey.IRI),
		boolToInt(dkey.Recursive),
		boolToInt(dkey.DepthOne),
		dkey.BlobTypes,
		protocolVersion,
	}
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

var qMaterializeReplace = dqb.Str(`
	INSERT OR IGNORE INTO rbsr_item (scope, blob)
	SELECT :scope, rb.id
	FROM rbsr_blobs rb
	JOIN blobs b ON b.id = rb.id
	WHERE b.size >= 0;`)

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
	if err := sqlitex.Exec(conn, qMaterializeReplace(), nil, scopeID); err != nil {
		return err
	}
	return sqlitex.Exec(conn, qMarkMaterialized(), nil, time.Now().Unix(), scopeID)
}

var qTouchScope = dqb.Str(`UPDATE rbsr_scope SET last_access = :now WHERE id = :scope;`)

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
// rbsr_item rows in a single ordered pass, applying codec canonicalization for
// the protocol version and per-item visibility — the same shape loadRBSRStore
// produces, but without re-running the closure. The store is not sealed here;
// the caller seals and filters it.
func buildStoreFromScopes(conn *sqlite.Conn, scopeIDs []int64, protocolVersion string, store *authorizedStore) (err error) {
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

		c := cid.NewCidV1(uint64(codecForProtocol(codec, protocolVersion)), hash) //nolint:gosec
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
	SELECT id, iri, recursive, depth_one, blob_types FROM rbsr_scope WHERE materialized = 1;`)

// loadMaterializedScopes returns the distinct discovery keys of all materialized
// scopes plus, for each key, the scope-row ids that share it. Membership is
// identical across protocol versions of the same key (canonicalization only
// changes advertised codecs, not which blobs belong), so the oracle runs once
// per key and the result fans out to every row.
func loadMaterializedScopes(conn *sqlite.Conn) (keys []DiscoveryKey, idsByKey map[DiscoveryKey][]int64, err error) {
	idsByKey = make(map[DiscoveryKey][]int64)
	if err := sqlitex.Exec(conn, qMaterializedScopes(), func(stmt *sqlite.Stmt) error {
		id := stmt.ColumnInt64(0)
		key := DiscoveryKey{
			IRI:       blob.IRI(stmt.ColumnText(1)),
			Recursive: stmt.ColumnInt64(2) != 0,
			DepthOne:  stmt.ColumnInt64(3) != 0,
			BlobTypes: stmt.ColumnText(4),
		}
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

// MaintainRBSRIndex is the incremental maintenance hook: for each freshly
// indexed blob it asks the oracle which materialized scopes the blob (and the
// forward closure it pulls in) joins, and patches those scopes' persisted sets.
// It runs inside the indexing transaction, so the patch commits atomically with
// the blob. Registered on the index via SetIndexedHook.
//
// Edges the oracle can't expand forward (it reports complete=false: inbound
// Contact-by-subject, capability delegation, late-arriving link targets) are
// not patched here; the shadow-verify sweep re-materializes any scope whose
// maintained fingerprint drifts from a fresh collectBlobs, which is the safety
// net for those.
func MaintainRBSRIndex(conn *sqlite.Conn, blobIDs []int64) error {
	keys, idsByKey, err := loadMaterializedScopes(conn)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return nil
	}

	for _, blobID := range blobIDs {
		inserts, _, err := affectedScopes(conn, blobID, keys)
		if err != nil {
			return err
		}
		for dkey, ids := range inserts {
			for _, scopeID := range idsByKey[dkey] {
				for _, bid := range ids {
					if err := sqlitex.Exec(conn, qInsertItem(), nil, scopeID, bid); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}
