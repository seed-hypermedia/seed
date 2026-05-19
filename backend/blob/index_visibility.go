package blob

import (
	"strings"

	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// Visibility determines the visibility of a blob.
type Visibility string

// Blob visibility values.
const (
	VisibilityPublic  Visibility = "" // Empty string because all blobs were public by default when we started.
	VisibilityPrivate Visibility = "Private"
)

// recordBlobVisibility records the visibility of a blob.
// For public blobs, spaceKeyID is 0 (which is converted to NULL in the database).
// For private blobs, spaceKeyID is the space owner's public key ID.
func recordBlobVisibility(conn *sqlite.Conn, blobID int64, space int64) error {
	return sqlitex.Exec(conn, qRecordBlobVisibility(), nil, blobID, space)
}

var qRecordBlobVisibility = dqb.Str(`
	INSERT OR IGNORE INTO blob_visibility (id, space)
	VALUES (:id, :space);
`)

func propagateVisibility(ictx *indexingCtx, id int64) (err error) {
	// Collect all distinct spaces that should propagate from this blob.
	// A blob can have multiple visibility rows (one per space), and we need to propagate all of them.
	spaces := make(map[int64]struct{})

	rows, discard, check := sqlitex.Query(ictx.conn, qVisibilityCheck(), id).All()
	defer discard(&err)
	for row := range rows {
		spaceKeyID := row.ColumnInt64(0)
		spaces[spaceKeyID] = struct{}{}
	}
	if err := check(); err != nil {
		return err
	}

	if len(spaces) == 0 {
		return nil
	}

	// Propagate for each distinct space (including public, spaceKeyID == 0).
	for space := range spaces {
		if err := sqlitex.Exec(ictx.conn, qForwardPropagation(), nil, map[string]any{
			":start_id": id,
			":space":    space,
		}); err != nil {
			return err
		}
	}

	return nil
}

// This query returns if any parent blob (according to the visibility rules)
// is already public, and points to the new blob that we've just created.
// Or if the new blob is already public by its nature.
// Returns the space ID of the blob if it should propagate (NULL for public blobs).
var qVisibilityCheck = dqb.Str(`
	SELECT bv.space
	FROM blob_links_with_types bl
	JOIN blob_visibility bv ON bv.id = bl.source
	JOIN blob_visibility_rules bvr
	 	ON (bvr.source_type = bl.source_type OR bvr.source_type = '*')
		AND (bvr.link_type = bl.link_type OR bvr.link_type = '*')
		AND (bvr.target_type = bl.target_type OR bvr.target_type = '*')
	WHERE bl.target = :new_blob_id
	UNION ALL
	SELECT bv.space FROM blob_visibility bv WHERE id = :new_blob_id;
`)

var qForwardPropagation = dqb.Str(`
	WITH RECURSIVE propagate (id) AS (
		SELECT :start_id
		UNION
		SELECT bl.target
		FROM propagate p
		JOIN blob_links_with_types bl ON bl.source = p.id
		JOIN blob_visibility_rules bvr
			ON (bvr.source_type = bl.source_type OR bvr.source_type = '*')
			AND (bvr.link_type = bl.link_type OR bvr.link_type = '*')
			AND (bvr.target_type = bl.target_type OR bvr.target_type = '*')
		WHERE bl.target NOT IN (
			SELECT id FROM blob_visibility WHERE space IS :space
		)
	)
	INSERT OR IGNORE INTO blob_visibility (id, space)
	SELECT id, :space FROM propagate;
`)

// propagateVisibilityBatch coalesces visibility propagation for a batch of
// newly-indexed blobs into one CTE walk per space, instead of one walk per
// blob. The recursive forward-propagation CTE is monotonic and the INSERT is
// OR IGNORE, so propagating from the union of seeds in one pass produces the
// same blob_visibility state as N sequential single-seed walks.
//
// Callers (currently only PutMany) are responsible for having already run
// every blob's indexers — and therefore its blob_links and any explicit
// blob_visibility seed rows — before calling this. We discover each blob's
// applicable spaces via qVisibilityCheck, group seeds by space, and run one
// CTE per distinct space.
func propagateVisibilityBatch(conn *sqlite.Conn, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	// space → seed blob ids that should propagate for that space.
	spaceSeeds := make(map[int64][]int64)
	for _, id := range ids {
		spaces, err := gatherVisibilitySpaces(conn, id)
		if err != nil {
			return err
		}
		for s := range spaces {
			spaceSeeds[s] = append(spaceSeeds[s], id)
		}
	}
	for space, seeds := range spaceSeeds {
		if err := propagateVisibilityForSpace(conn, seeds, space); err != nil {
			return err
		}
	}
	return nil
}

// gatherVisibilitySpaces returns the distinct spaces this blob should
// propagate to, equivalent to the loop inside propagateVisibility that
// runs qVisibilityCheck and collects rows.
func gatherVisibilitySpaces(conn *sqlite.Conn, id int64) (map[int64]struct{}, error) {
	spaces := make(map[int64]struct{})
	rows, discard, check := sqlitex.Query(conn, qVisibilityCheck(), id).All()
	var err error
	defer discard(&err)
	for row := range rows {
		spaces[row.ColumnInt64(0)] = struct{}{}
	}
	err = check()
	return spaces, err
}

// propagateVisibilityForSpace runs one forward-propagation CTE for a single
// space with N seed blobs supplied as a multi-row VALUES clause. The body of
// the recursion is identical to qForwardPropagation; only the initial term
// changes from a single :start_id row to N rows. Bind args: seed1..seedN,
// space, space (last two are the same value, used twice in the query).
func propagateVisibilityForSpace(conn *sqlite.Conn, seeds []int64, space int64) error {
	if len(seeds) == 0 {
		return nil
	}
	var seedRows strings.Builder
	args := make([]any, 0, len(seeds)+2)
	for i, sid := range seeds {
		if i > 0 {
			seedRows.WriteString(", ")
		}
		seedRows.WriteString("(?)")
		args = append(args, sid)
	}
	args = append(args, space, space)
	q := `WITH RECURSIVE propagate (id) AS (
		SELECT column1 FROM (VALUES ` + seedRows.String() + `)
		UNION
		SELECT bl.target
		FROM propagate p
		JOIN blob_links_with_types bl ON bl.source = p.id
		JOIN blob_visibility_rules bvr
			ON (bvr.source_type = bl.source_type OR bvr.source_type = '*')
			AND (bvr.link_type = bl.link_type OR bvr.link_type = '*')
			AND (bvr.target_type = bl.target_type OR bvr.target_type = '*')
		WHERE bl.target NOT IN (
			SELECT id FROM blob_visibility WHERE space IS ?
		)
	)
	INSERT OR IGNORE INTO blob_visibility (id, space)
	SELECT id, ? FROM propagate;`
	return sqlitex.ExecTransient(conn, q, nil, args...)
}
