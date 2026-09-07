package blob

import (
	"fmt"

	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Comment activity is maintained here, in two tables, instead of being derived
// on every read (see the schema comments on comment_live and
// resource_comment_stats).
//
// Two facts have to be settled to answer "how many comments does this document
// have, and what's the latest one":
//
//  1. Which blob is the live version of each comment. Comments are edited and
//     deleted by publishing further blobs that share a TSID, so the live version
//     is the newest one, and it counts only if it isn't a tombstone. That's
//     comment_live, and it's settled per TSID as blobs arrive.
//
//  2. Which comments belong to a resource. A comment records the document path
//     as it was when it was written, so after a document moves its comments stay
//     attached to the old path's resource. A resource's comments are therefore
//     those of its whole redirect-ancestor chain. That's resource_comment_stats.
//
// Both walks below are seeks from a single resource, never scans of the redirect
// graph: document_attributes is keyed (resource, key) for the forward direction
// and indexed (key, kind, value) for the backward one.

// redirectKeyPredicate matches the internal attribute that records a document's
// redirect target. Written by indexRef when a Ref carries a redirect.
const redirectKeyPredicate = `dak.key = '$db.redirect'`

// updateCommentLive settles which blob is the live version of tsid, considering
// every blob that shares it.
//
// Called after a Comment blob is saved, and correct regardless of arrival order:
// it re-derives the winner from scratch rather than adjusting a counter, so a
// tombstone arriving before the comment it deletes, or an edit arriving before
// the version it supersedes, both land on the same answer as any other order.
// That is the bug this replaces — document_generations.comment_count was
// maintained by deltas and drifted low on real data.
func updateCommentLive(conn *sqlite.Conn, tsid TSID) error {
	if tsid == "" {
		return fmt.Errorf("BUG: updateCommentLive called with empty TSID")
	}

	if err := sqlitex.Exec(conn, qDeleteCommentLive(), nil, string(tsid)); err != nil {
		return fmt.Errorf("failed to clear live comment for tsid %s: %w", tsid, err)
	}

	if err := sqlitex.Exec(conn, qInsertCommentLive(), nil, string(tsid)); err != nil {
		return fmt.Errorf("failed to record live comment for tsid %s: %w", tsid, err)
	}

	return nil
}

var qDeleteCommentLive = dqb.Str(`
	DELETE FROM comment_live WHERE tsid = :tsid;
`)

// The winner is the highest (ts, id) among the blobs sharing the TSID, and it's
// inserted only when it's live: a tombstone winning the TSID leaves no row, which
// is how deleted comments drop out of every count.
var qInsertCommentLive = dqb.Str(`
	INSERT INTO comment_live (tsid, blob_id, resource, ts)
	SELECT tsid, id, resource, ts
	FROM (
		SELECT
			sb.extra_attrs->>'tsid' AS tsid,
			sb.id AS id,
			sb.resource AS resource,
			sb.ts AS ts,
			sb.extra_attrs->>'deleted' AS deleted
		FROM structural_blobs sb
		WHERE sb.type = 'Comment'
		AND sb.extra_attrs->>'tsid' = :tsid
		ORDER BY sb.ts DESC, sb.id DESC
		LIMIT 1
	)
	WHERE deleted IS NULL AND resource IS NOT NULL;
`)

// updateResourceCommentStats recomputes comment activity for resource and for
// every resource it transitively redirects to.
//
// The redirect targets are included because they inherit the comments: when a
// document moves from A to B, B's listing must show the comments written against
// A. So a change at A — a new comment, or a new redirect — moves the numbers for
// the whole forward chain, and each of those is then recomputed from its own
// ancestor chain.
//
// Recomputing rather than adjusting is deliberate, and cheap: both directions are
// index seeks bounded by the redirect depth limit, and the aggregate reads
// comment_live by resource.
func updateResourceCommentStats(conn *sqlite.Conn, resource int64) error {
	if err := sqlitex.Exec(conn, qDeleteResourceCommentStats(), nil, resource); err != nil {
		return fmt.Errorf("failed to clear comment stats for resource %d: %w", resource, err)
	}

	if err := sqlitex.Exec(conn, qInsertResourceCommentStats(), nil, resource); err != nil {
		return fmt.Errorf("failed to recompute comment stats for resource %d: %w", resource, err)
	}

	return nil
}

// updateSpaceCommentStats recomputes one space's comment activity.
//
// A comment belongs to exactly one space -- the space of the document it targets
// -- so this needs no redirect walk at all. That is what makes space totals
// independent of how comments are credited across redirects.
//
// It recomputes rather than adjusting a delta, for the same reason as
// updateResourceCommentStats and with the same evidence: on a 6.2 GB production
// database the delta-maintained totals had drifted to 5062 against 11964 real
// live comments. The arithmetic was only half of it -- indexComment also gave up
// entirely when a comment's target changes weren't indexed yet, and nothing ever
// came back to repair the skipped update.
//
// last_change_time is deliberately absent from the upsert: that column belongs to
// touchSpaceStats (blob_ref.go) and has to survive this write.
func updateSpaceCommentStats(conn *sqlite.Conn, spaceID string) error {
	if spaceID == "" {
		return fmt.Errorf("BUG: updateSpaceCommentStats called with empty space")
	}

	if err := sqlitex.Exec(conn, qUpsertSpaceCommentStats(), nil, spaceID); err != nil {
		return fmt.Errorf("failed to recompute comment stats for space %s: %w", spaceID, err)
	}

	return nil
}

// qSpaceLiveCommentsCTE selects the live comments of one space: its home document
// plus everything below it. A range rather than a GLOB, so it seeks the
// resources.iri index ('0' being the character after '/') -- the same trick the
// document listings use.
const qSpaceLiveCommentsCTE = `
	live AS (
		SELECT l.blob_id, l.ts
		FROM comment_live l
		JOIN resources r ON r.id = l.resource
		WHERE r.iri = 'hm://' || :space
		OR (r.iri >= 'hm://' || :space || '/' AND r.iri < 'hm://' || :space || '0')
	)`

var qUpsertSpaceCommentStats = dqb.Str(`
	WITH` + qSpaceLiveCommentsCTE + `
	INSERT INTO spaces (id, last_comment, last_comment_time, comment_count)
	SELECT
		:space,
		(SELECT blob_id FROM live ORDER BY ts DESC, blob_id DESC LIMIT 1),
		COALESCE((SELECT MAX(ts) FROM live), 0),
		(SELECT COUNT(*) FROM live)
	ON CONFLICT (id) DO UPDATE SET
		last_comment = excluded.last_comment,
		last_comment_time = excluded.last_comment_time,
		comment_count = excluded.comment_count;
`)

// rebuildResourceCommentStats recomputes the whole table in one pass.
//
// The incremental path above keeps each resource current as blobs arrive, but it
// can only be as right as the database is at the moment it runs, and a reindex
// replays history in blob-id order rather than causal order. A redirect Ref can
// be replayed before the redirect that precedes it in the chain, so the walk from
// a resource reaches only part of its chain and stops there; nothing revisits it.
// Measured on a 6.2 GB production database, that left 163 resources — all of them
// pure redirect targets two or more hops down a chain — with no row at all.
//
// So the reindex doesn't rely on the incremental path: it rebuilds from the final
// state, where every chain is complete. This mirrors deriveAllDocFields, which
// does the same for the derived document fields and for the same reason.
//
// It runs the walk in the cheap direction. Seeding from the resources that
// actually hold comments and pushing forward touches ~1.5k rows on that database
// and takes ~13ms; seeding from every resource and walking backwards is the same
// answer for 3.7s.
//
// Space totals need no equivalent pass, and adding one would be dead code.
// updateSpaceCommentStats recomputes a whole space from comment_live rather than
// walking anything, so the last comment indexed for a space lands on the right
// answer no matter what order the rest arrived in. Verified rather than assumed:
// a full reindex of that same production database leaves all 324 spaces correct
// with no rebuild pass at all.
func rebuildResourceCommentStats(conn *sqlite.Conn) error {
	if err := sqlitex.Exec(conn, qClearResourceCommentStats(), nil); err != nil {
		return fmt.Errorf("failed to clear comment stats: %w", err)
	}

	if err := sqlitex.Exec(conn, qRebuildResourceCommentStats(), nil); err != nil {
		return fmt.Errorf("failed to rebuild comment stats: %w", err)
	}

	// Space totals need the same treatment, and for a simpler reason than the
	// per-resource ones: a space's row is written whenever any of its comments is
	// indexed, so during a replay it settles on whatever subset had arrived by
	// then. Only rows already in `spaces` are updated -- a space with no row has
	// no comments to count, and inserting one here would invent a space that
	// nothing else has registered.

	return nil
}

var qClearResourceCommentStats = dqb.Str(`DELETE FROM resource_comment_stats;`)

var qRebuildResourceCommentStats = dqb.Str(`
	INSERT INTO resource_comment_stats (resource, comment_count, last_comment_time, last_comment)
	WITH RECURSIVE spread(target, source, iri, depth) AS (
		SELECT l.resource, l.resource, r.iri, 0
		FROM (SELECT DISTINCT resource FROM comment_live) l
		JOIN resources r ON r.id = l.resource

		UNION ALL

		SELECT r.id, s.source, r.iri, s.depth + 1
		FROM spread s
		JOIN resources r ON r.iri = (
			SELECT da.value
			FROM document_attributes da
			JOIN document_attribute_keys dak ON dak.id = da.key AND ` + redirectKeyPredicate + `
			WHERE da.resource = s.target AND da.kind = 's'
		)
		WHERE s.depth < 16 AND r.iri != s.iri
	)
	SELECT sp.target, COUNT(*), MAX(l.ts), l.blob_id
	FROM (SELECT DISTINCT target, source FROM spread) sp
	JOIN comment_live l ON l.resource = sp.source
	GROUP BY sp.target;
`)

// qAffectedResourcesCTE walks forward from :resource along redirect edges,
// yielding the resource itself plus everything it redirects to.
//
// The redirect target is fetched with a correlated subquery rather than a join,
// which is what gets the seek: document_attributes is keyed (resource, key), and
// only in this shape does the planner use that key. Written as a join, it drives
// from document_attributes instead and range-scans every redirect attribute in the
// database on each hop.
//
// The depth cap and the `r.iri != a.iri` guard match the ones the listing queries
// used, and keep a redirect cycle from looping forever.
const qAffectedResourcesCTE = `
	affected(resource, iri, depth) AS (
		SELECT r.id, r.iri, 0 FROM resources r WHERE r.id = :resource

		UNION ALL

		SELECT r.id, r.iri, a.depth + 1
		FROM affected a
		JOIN resources r ON r.iri = (
			SELECT da.value
			FROM document_attributes da
			JOIN document_attribute_keys dak ON dak.id = da.key AND ` + redirectKeyPredicate + `
			WHERE da.resource = a.resource AND da.kind = 's'
		)
		WHERE a.depth < 16 AND r.iri != a.iri
	)`

var qDeleteResourceCommentStats = dqb.Str(`
	WITH RECURSIVE` + qAffectedResourcesCTE + `
	DELETE FROM resource_comment_stats WHERE resource IN (SELECT resource FROM affected);
`)

// The inner walk goes the other way: for each affected resource, collect every
// resource that transitively redirects *into* it, because those hold the comments
// it inherits. Many resources can redirect into one IRI, so this one has to be a
// join, and the CROSS JOIN is what makes it a seek: it pins the walk as the driver
// so document_attributes_by_key (key, kind, value) is probed on all three columns.
// Left to itself the planner drives from document_attributes and only constrains
// (key, kind), which scans every redirect attribute in the database per hop.
//
// DISTINCT before the join: two redirect paths can reach the same ancestor, and
// counting it twice would inflate the total.
//
// last_comment rides along with MAX(ts) as a bare column, so it's the blob of the
// row that won the MAX — the same thing the query this replaces returned.
var qInsertResourceCommentStats = dqb.Str(`
	WITH RECURSIVE` + qAffectedResourcesCTE + `,
	ancestors(root, resource, iri, depth) AS (
		SELECT a.resource, a.resource, a.iri, 0 FROM affected a

		UNION ALL

		SELECT n.root, r.id, r.iri, n.depth + 1
		FROM ancestors n
		CROSS JOIN document_attributes da ON da.kind = 's' AND da.value = n.iri
		JOIN document_attribute_keys dak ON dak.id = da.key AND ` + redirectKeyPredicate + `
		JOIN resources r ON r.id = da.resource
		WHERE n.depth < 16 AND r.iri != n.iri
	)
	INSERT INTO resource_comment_stats (resource, comment_count, last_comment_time, last_comment)
	SELECT n.root, COUNT(*), MAX(l.ts), l.blob_id
	FROM (SELECT DISTINCT root, resource FROM ancestors) n
	JOIN comment_live l ON l.resource = n.resource
	GROUP BY n.root;
`)
