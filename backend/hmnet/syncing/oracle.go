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
