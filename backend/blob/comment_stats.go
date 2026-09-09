package blob

import (
	"fmt"

	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
)

// Comment activity is maintained here, in two tables, instead of being derived on
// every read (see the schema comments on comment_live and document_comment_stats).
//
// Two facts have to be settled to answer "how many comments does this document
// have, and what's the latest one":
//
//  1. Which blob is the live version of each comment. Comments are edited and
//     deleted by publishing further blobs that share a TSID, so the live version
//     is the newest one, and it counts only if it isn't a tombstone. That's
//     comment_live, settled per TSID as blobs arrive.
//
//  2. Which document a comment belongs to. That's the genesis of the document its
//     target version belongs to -- an identity, not a location. A document keeps
//     its genesis when it moves, so its comments follow it without anyone walking
//     a redirect chain; and a redirect between two unrelated documents can't merge
//     their comments, because their genesises differ.
//
// Both are recomputed from scratch rather than adjusted by deltas. That makes them
// insensitive to arrival order, which matters because blobs sync out of order and a
// reindex replays them in blob-id order rather than causal order.

// updateCommentLive settles which blob is the live version of tsid, considering
// every blob that shares it.
//
// Correct regardless of arrival order: it re-derives the winner from scratch, so a
// tombstone arriving before the comment it deletes, or an edit arriving before the
// version it supersedes, both land on the same answer as any other order.
//
// genesis is the target document's genesis, resolved by the caller. Every version
// of one comment targets the same document, so it's the same for every blob sharing
// the TSID, and it's safe to stamp the caller's value onto whichever blob wins.
func updateCommentLive(conn *sqlite.Conn, tsid TSID, genesis string) error {
	if tsid == "" {
		return fmt.Errorf("BUG: updateCommentLive called with empty TSID")
	}

	if genesis == "" {
		return fmt.Errorf("BUG: updateCommentLive called with empty genesis for tsid %s", tsid)
	}

	if err := sqlitex.Exec(conn, qDeleteCommentLive(), nil, string(tsid)); err != nil {
		return fmt.Errorf("failed to clear live comment for tsid %s: %w", tsid, err)
	}

	if err := sqlitex.Exec(conn, qInsertCommentLive(), nil, string(tsid), genesis); err != nil {
		return fmt.Errorf("failed to record live comment for tsid %s: %w", tsid, err)
	}

	return nil
}

var qDeleteCommentLive = dqb.Str(`
	DELETE FROM comment_live WHERE tsid = ?1;
`)

// The winner is the highest (ts, id) among the blobs sharing the TSID, and it's
// inserted only when it's live: a tombstone winning the TSID leaves no row, which
// is how deleted comments drop out of every count.
//
// Numbered parameters, not named: SQLite assigns named parameters their indices in
// order of first appearance in the text, so ?1/?2 keeps the binding order tied to
// the Go call rather than to where each name happens to sit in the query.
var qInsertCommentLive = dqb.Str(`
	INSERT INTO comment_live (tsid, blob_id, genesis, resource, ts)
	SELECT tsid, id, ?2, resource, ts
	FROM (
		SELECT
			sb.extra_attrs->>'tsid' AS tsid,
			sb.id AS id,
			sb.resource AS resource,
			sb.ts AS ts,
			sb.extra_attrs->>'deleted' AS deleted
		FROM structural_blobs sb
		WHERE sb.extra_attrs->>'tsid' IS NOT NULL
		AND sb.extra_attrs->>'tsid' = ?1
		AND sb.type = 'Comment'
		ORDER BY sb.ts DESC, sb.id DESC
		LIMIT 1
	)
	WHERE deleted IS NULL AND resource IS NOT NULL;
`)

// updateDocumentCommentStats recomputes one document's comment activity.
//
// No walk of any kind: the document is the genesis, and comment_live is indexed by
// it. This replaces a pair of recursive redirect walks that used to run here, and
// that had to be reasoned about carefully because they could reach only part of a
// chain when blobs were replayed out of order.
//
// Being a full recompute per genesis, it's also self-correcting: the last comment
// indexed for a document lands on the right answer no matter what order the rest
// arrived in, so no end-of-reindex rebuild pass is needed.
func updateDocumentCommentStats(conn *sqlite.Conn, genesis string) error {
	if genesis == "" {
		return fmt.Errorf("BUG: updateDocumentCommentStats called with empty genesis")
	}

	if err := sqlitex.Exec(conn, qUpsertDocumentCommentStats(), nil, genesis); err != nil {
		return fmt.Errorf("failed to recompute comment stats for genesis %s: %w", genesis, err)
	}

	if err := sqlitex.Exec(conn, qPruneDocumentCommentStats(), nil, genesis); err != nil {
		return fmt.Errorf("failed to prune comment stats for genesis %s: %w", genesis, err)
	}

	return nil
}

var qUpsertDocumentCommentStats = dqb.Str(`
	WITH live AS (
		SELECT blob_id, ts FROM comment_live WHERE genesis = :genesis
	)
	INSERT INTO document_comment_stats (genesis, last_comment, last_comment_time, comment_count)
	SELECT
		:genesis,
		(SELECT blob_id FROM live ORDER BY ts DESC, blob_id DESC LIMIT 1),
		COALESCE((SELECT MAX(ts) FROM live), 0),
		(SELECT COUNT(*) FROM live)
	ON CONFLICT (genesis) DO UPDATE SET
		last_comment = excluded.last_comment,
		last_comment_time = excluded.last_comment_time,
		comment_count = excluded.comment_count;
`)

// Deleting the last comment of a document leaves a zero row, which would report
// the same as no row but keep the table growing. Drop it instead.
var qPruneDocumentCommentStats = dqb.Str(`
	DELETE FROM document_comment_stats WHERE genesis = :genesis AND comment_count = 0;
`)

// updateSpaceCommentStats recomputes one space's comment activity.
//
// Space totals are attributed by location, not identity: a comment counts for the
// space of the path it was written against. So this reads comment_live by resource
// while the document counts above read it by genesis, and the two are independent.
//
// It recomputes rather than adjusting a delta, for the same reason as everything
// else here and with the same evidence: on a 6.2 GB production database the
// delta-maintained totals had drifted to 5062 against 11964 real live comments. The
// arithmetic was only half of it -- indexComment also gave up entirely when a
// comment's target changes weren't indexed yet, and nothing ever came back to
// repair the skipped update.
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

// The scope is the space's own home document plus everything below it, expressed as
// a range rather than a GLOB so it seeks the resources.iri index ('0' being the
// character after '/') -- the same trick the document listings use.
var qUpsertSpaceCommentStats = dqb.Str(`
	WITH live AS (
		SELECT l.blob_id, l.ts
		FROM comment_live l
		JOIN resources r ON r.id = l.resource
		WHERE r.iri = 'hm://' || :space
		OR (r.iri >= 'hm://' || :space || '/' AND r.iri < 'hm://' || :space || '0')
	)
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

// lookupResourceGenesis returns the genesis of the document currently at a
// resource, or "" if it has no generation yet.
//
// Used for comments that pin no target version: they mean "the document at this
// path", so their identity is whatever genesis that path currently resolves to.
func lookupResourceGenesis(conn *sqlite.Conn, resource int64) (out string, err error) {
	rows, discard, check := sqlitex.Query(conn, qResourceGenesis(), resource).All()
	defer discard(&err)
	for row := range rows {
		out = row.ColumnText(0)
		break
	}

	return out, check()
}

var qResourceGenesis = dqb.Str(`
	SELECT dg.genesis
	FROM document_generations dg
	WHERE dg.resource = ?1
	GROUP BY dg.resource
	HAVING dg.generation = MAX(dg.generation);
`)

// lookupBlobCID returns the CID string of a blob id. Used to turn the genesis blob
// id that changeMetadata carries into the form document_generations.genesis stores,
// so the listings can join on it directly.
func lookupBlobCID(conn *sqlite.Conn, id int64) (out string, err error) {
	rows, discard, check := sqlitex.Query(conn, qLookupCID(), id).All()
	defer discard(&err)
	for row := range rows {
		out = cid.NewCidV1(uint64(row.ColumnInt64(0)), row.ColumnBytes(1)).String() //nolint:gosec
		break
	}

	if err := check(); err != nil {
		return "", err
	}

	if out == "" {
		return "", fmt.Errorf("no CID found for blob %d", id)
	}

	return out, nil
}
