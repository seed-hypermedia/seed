package syncing

import (
	"seed/backend/blob"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"strings"
)

// The oracle answers, for a freshly-indexed blob, which maintained RBSR scopes
// gain which blobs because of it. It is the incremental inverse of
// [collectBlobs]: instead of recomputing a scope's whole set, it patches only
// the scopes the new blob touches. Correctness is defined entirely against
// collectBlobs — every (scope, blob) the oracle reports as added MUST also be
// what collectBlobs would produce, and (for the edges it covers) it must miss
// nothing. The differential tests assert exactly that.
//
// Design — seed and forward, not reverse queries. The RBSR set is built by
// collectBlobs with includeLinksCitationsAccounts=false (see loadRBSRStore), so
// a scope's members come from: (1) resource-anchored structural blobs, (2) the
// inbound-Contact-by-subject edge, then forward closures over (3) ref/head +
// change/dep, (4) media links, and (5) capability delegation. Closures (3)–(5)
// are forward walks from a seed set. So the only genuinely new logic the oracle
// needs is the *seeding* decision (which new blob enters which scope directly);
// the closures are then re-run from that seed. Re-running the existing forward
// walk — rather than hand-writing a reverse query per edge — is what keeps the
// oracle from silently diverging from collectBlobs.
//
// Coverage of this implementation: the resource-anchored seed and the
// ref/head+change/dep change-closure — i.e. the dominant path of a document
// being edited (a new Ref plus the Changes it heads). The media and capability
// closures and the inbound-Contact edge are not yet expanded incrementally;
// when a blob touches one of them affectedScopes reports complete=false so the
// caller can fall back to re-materializing the affected scopes. Shadow-verify
// (comparing a maintained scope's fingerprint against a fresh collectBlobs
// materialization) remains the backstop for any missed edge.

// resourceScopedTypes are the structural blob types that collectBlobs pulls
// into a scope purely by their resource anchoring (fillTables' resource-scoped
// INSERT). Changes are deliberately absent: they carry no resource and enter
// only through the ref/head+change/dep closure.
var resourceScopedTypes = map[string]struct{}{
	"Ref":        {},
	"Capability": {},
	"Comment":    {},
	"Profile":    {},
	"Contact":    {},
}

// scopeCovers reports whether scope s includes the resource identified by iri
// via the scope's own IRI pattern, mirroring fillTables exactly: an exact match
// always counts; a subtree match counts when Recursive; a direct-child match
// counts when DepthOne. Version is intentionally ignored, as fillTables ignores
// it when selecting resources.
func scopeCovers(s DiscoveryKey, iri blob.IRI) bool {
	r := string(iri)
	base := string(s.IRI)
	if r == base {
		return true
	}
	prefix := base + "/"
	if !strings.HasPrefix(r, prefix) {
		return false
	}
	switch {
	case s.Recursive:
		return true
	case s.DepthOne:
		// Direct child only: no further '/' after the prefix, matching
		// "iri GLOB base/* AND iri NOT GLOB base/*/*".
		return !strings.Contains(r[len(prefix):], "/")
	default:
		return false
	}
}

// scopeAllowsType reports whether scope s's per-key blob-type allowlist admits
// t. An empty allowlist means "no filter" and admits everything, matching
// hasType over a single key's BlobTypes.
func scopeAllowsType(s DiscoveryKey, t string) bool {
	if s.BlobTypes == "" {
		return true
	}
	return slices.Contains(strings.Split(s.BlobTypes, ","), t)
}

// qMediaClosure walks blob_links forward from a single seed blob along EVERY
// link type, transitively, excluding stashed blobs — byte-for-byte the same
// traversal collectBlobs runs from its whole seed set ("Fill media files"),
// restricted here to one new blob. This subsumes the ref/head + change/dep
// change-closure: those are just two of the link types this walk follows, which
// is why collectBlobs pulls Changes into a scope even when the type filter omits
// them. The closure is deliberately not type-filtered; only the seeding
// decision is (see affectedScopes).
var qMediaClosure = dqb.Str(`
	WITH RECURSIVE media (id) AS (
		SELECT bl.target
		FROM blob_links bl
		WHERE bl.source = :seed
		UNION
		SELECT bl.target
		FROM blob_links bl
		JOIN media m ON m.id = bl.source
	)
	SELECT m.id
	FROM media m
	LEFT OUTER JOIN stashed_blobs ON stashed_blobs.id = m.id
	WHERE stashed_blobs.id IS NULL;`)

// qBlobFacts fetches the type and resource IRI (empty when unanchored, as for
// Changes) of a freshly-indexed blob.
var qBlobFacts = dqb.Str(`
	SELECT sb.type, COALESCE(r.iri, '')
	FROM structural_blobs sb
	LEFT JOIN resources r ON r.id = sb.resource
	WHERE sb.id = :id;`)

// affectedScopes returns, for the freshly-indexed blob blobID, the blob IDs that
// each candidate scope gains because of it, computed by the resource-anchored
// seed plus the change-closure walk.
//
// complete reports whether the result is the full set of blobs the scopes gain.
// It is false when the blob participates in an edge this implementation does not
// expand incrementally (media links, capability delegation, or the
// inbound-Contact-by-subject edge); the caller must then re-materialize the
// affected scopes rather than trust the partial result. The reported inserts are
// always sound (a subset of what collectBlobs would produce) regardless.
func affectedScopes(conn *sqlite.Conn, blobID int64, scopes []DiscoveryKey) (inserts map[DiscoveryKey][]int64, complete bool, err error) {
	var (
		blobType  string
		resourceI string
		found     bool
	)
	if err := sqlitex.Exec(conn, qBlobFacts(), func(stmt *sqlite.Stmt) error {
		found = true
		blobType = stmt.ColumnText(0)
		resourceI = stmt.ColumnText(1)
		return nil
	}, blobID); err != nil {
		return nil, false, err
	}

	// A non-structural blob (Raw/DagPB) arriving on its own is only ever a
	// member through the media closure of some structural blob that links *to*
	// it — a reverse edge we don't expand incrementally. Report incompleteness.
	if !found {
		return nil, false, nil
	}

	// Contact and Capability can enter scopes through edges that are not a
	// forward link-walk from the blob: the inbound-Contact-by-subject edge
	// (keyed on the contact's subject account) and the capability-delegation
	// closure (keyed on the delegate's authored blobs). The resource-anchored
	// inserts we compute below are still sound for those types, but a scope may
	// gain the blob through one of these edges too, so the caller must
	// re-materialize rather than trust completeness.
	complete = blobType != "Contact" && blobType != "Capability"

	if _, isResourceScoped := resourceScopedTypes[blobType]; !isResourceScoped || resourceI == "" {
		// Nothing seeds directly; e.g. a bare Change (carried into a scope by
		// the Ref that heads it, handled when that Ref is indexed).
		return nil, complete, nil
	}

	// The forward media closure is identical for every scope the blob seeds, so
	// compute it once. inserts[scope] = {blob} ∪ closure.
	closure := []int64{blobID}
	if err := sqlitex.Exec(conn, qMediaClosure(), func(stmt *sqlite.Stmt) error {
		closure = append(closure, stmt.ColumnInt64(0))
		return nil
	}, blobID); err != nil {
		return nil, false, err
	}

	iri := blob.IRI(resourceI)
	for _, s := range scopes {
		if !scopeCovers(s, iri) || !scopeAllowsType(s, blobType) {
			continue
		}
		if inserts == nil {
			inserts = make(map[DiscoveryKey][]int64, len(scopes))
		}
		inserts[s] = closure
	}

	return inserts, complete, nil
}

// ============================================================================
// Incremental maintenance for the collectBlobs edges that the forward
// seed/closure above does NOT cover: the recursive agent-capability delegation
// closure, the inbound Contact-by-subject edge, and late-arriving forward link
// targets. Previously every one of these drifted until the periodic
// shadow-verify re-materialized the scope; under real sync load (a team site
// with hundreds of agent capabilities, blobs arriving wildly out of order) that
// 5-minute sweep cannot keep pace and the maintained set serves ~40% short.
//
// Each function below patches a materialized scope's rbsr_item set the moment
// the triggering blob is indexed, mirroring the matching collectBlobs step
// (discovery.go) over the persisted set instead of a temp rebuild, so the
// maintained set stays equal to a fresh materialization without the sweep.
// They operate on downloaded (size>=0), non-stashed blobs only — exactly the
// set materialize/shadow-verify count, so they never introduce "extra" drift.
// ============================================================================

// qScopesLinkingTo returns the materialized scopes that already contain a blob
// linking (any type) to :target — the one-hop reverse of qMediaClosure's
// forward edge. If member M is in scope S and M->X is a blob_link,
// collectBlobs' forward walk puts X in S; so an X that arrived after M (whose
// closure missed it) joins S now. Uses the blob_backlinks index.
var qScopesLinkingTo = dqb.Str(`
	SELECT DISTINCT ri.scope
	FROM blob_links bl
	JOIN rbsr_item ri ON ri.blob = bl.source
	WHERE bl.target = :target;`)

// qForwardClosureDownloaded returns :seed plus its transitive forward closure
// over every blob_link type, restricted to downloaded, non-stashed blobs — the
// same traversal qMediaClosure runs, but rooted at the seed and filtered to the
// rows a scope's materialized set actually contains.
var qForwardClosureDownloaded = dqb.Str(`
	WITH RECURSIVE fc (id) AS (
		SELECT :seed
		UNION
		SELECT bl.target FROM blob_links bl JOIN fc ON fc.id = bl.source
	)
	SELECT fc.id
	FROM fc
	JOIN blobs b ON b.id = fc.id
	LEFT JOIN stashed_blobs s ON s.id = fc.id
	WHERE s.id IS NULL AND b.size >= 0;`)

// scopesLinkingTo lists materialized scopes with an existing member linking to target.
func scopesLinkingTo(conn *sqlite.Conn, target int64) (out []int64, err error) {
	err = sqlitex.Exec(conn, qScopesLinkingTo(), func(stmt *sqlite.Stmt) error {
		out = append(out, stmt.ColumnInt64(0))
		return nil
	}, target)
	return out, err
}

// forwardClosureDownloaded returns seed + its downloaded forward closure.
func forwardClosureDownloaded(conn *sqlite.Conn, seed int64) (out []int64, err error) {
	err = sqlitex.Exec(conn, qForwardClosureDownloaded(), func(stmt *sqlite.Stmt) error {
		out = append(out, stmt.ColumnInt64(0))
		return nil
	}, seed)
	return out, err
}

// qScopesWithAuthor returns materialized scopes containing a blob authored by
// :author — used to find which scopes a freshly indexed AGENT capability joins
// (its delegate authored an in-scope blob).
var qScopesWithAuthor = dqb.Str(`
	SELECT DISTINCT ri.scope
	FROM rbsr_item ri
	JOIN structural_blobs sb ON sb.id = ri.blob
	WHERE sb.author = :author;`)

// scopesWithAuthor lists materialized scopes containing a blob authored by author.
func scopesWithAuthor(conn *sqlite.Conn, author int64) (out []int64, err error) {
	err = sqlitex.Exec(conn, qScopesWithAuthor(), func(stmt *sqlite.Stmt) error {
		out = append(out, stmt.ColumnInt64(0))
		return nil
	}, author)
	return out, err
}

// qAgentCapStep adds, to one scope, every downloaded AGENT Capability whose
// delegate authored a blob already in that scope — one iteration of the
// recursive capability closure in collectBlobs (discovery.go). Idempotent
// (INSERT OR IGNORE); the caller loops it to a fixpoint because a capability
// just added introduces its own author, which may delegate further.
var qAgentCapStep = dqb.Str(`
	INSERT OR IGNORE INTO rbsr_item (scope, blob)
	SELECT :scope, sb.id
	FROM structural_blobs sb INDEXED BY capabilities_by_delegate
	JOIN blobs b ON b.id = sb.id
	LEFT JOIN stashed_blobs s ON s.id = sb.id
	WHERE sb.type = 'Capability'
		AND sb.extra_attrs->>'role' = 'AGENT'
		AND s.id IS NULL AND b.size >= 0
		AND sb.extra_attrs->>'del' IN (
			SELECT sb2.author
			FROM rbsr_item ri
			JOIN structural_blobs sb2 ON sb2.id = ri.blob
			WHERE ri.scope = :scope AND sb2.author IS NOT NULL
		);`)

// runAgentCapClosure runs the agent-capability delegation closure for one scope
// to a fixpoint, mirroring collectBlobs' recursive Capability step.
func runAgentCapClosure(conn *sqlite.Conn, scopeID int64) error {
	for {
		if err := sqlitex.Exec(conn, qAgentCapStep(), nil, scopeID); err != nil {
			return err
		}
		if conn.Changes() == 0 {
			return nil
		}
	}
}

var qPublicKeyIDByPrincipal = dqb.Str(`SELECT id FROM public_keys WHERE principal = :principal;`)

// rootScopesBySubject maps a public-key id to the materialized recursive
// account-root scopes for that account. Used for the inbound Contact-by-subject
// edge: a Contact is anchored to its creator's resource, but collectBlobs pulls
// it into the *subject* account's recursive scope (discovery.go), so a freshly
// indexed Contact must be added to the subject account's scopes here.
func rootScopesBySubject(conn *sqlite.Conn, keys []DiscoveryKey, idsByKey map[DiscoveryKey][]int64) (map[int64][]int64, error) {
	out := map[int64][]int64{}
	for _, k := range keys {
		if !k.Recursive {
			continue
		}
		space, path, err := k.IRI.SpacePath()
		if err != nil || path != "" {
			continue
		}
		var pkid int64
		var found bool
		if err := sqlitex.Exec(conn, qPublicKeyIDByPrincipal(), func(stmt *sqlite.Stmt) error {
			pkid = stmt.ColumnInt64(0)
			found = true
			return nil
		}, []byte(space)); err != nil {
			return nil, err
		}
		if found {
			out[pkid] = append(out[pkid], idsByKey[k]...)
		}
	}
	return out, nil
}
