package blob

import (
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
