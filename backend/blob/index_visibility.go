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

func propagateVisibility(ictx *indexingCtx, id int64) error {
	var propagatePublic bool
	if err := sqlitex.Exec(ictx.conn, qVisibilityCheck(), func(*sqlite.Stmt) error {
		propagatePublic = true
		return nil
	}, map[string]any{":new_blob_id": id}); err != nil {
		return err
	}

	if !propagatePublic {
		return nil
	}

	return sqlitex.Exec(ictx.conn, qForwardPropagation(), nil, map[string]any{
		":start_id": id,
	})
}

// This query returns as long as any parent blob (according to the visibility rules)
// is already public, and points to the new blob that we've just created.
// Or if the new blob is already public by its nature.
var qVisibilityCheck = dqb.Str(`
	SELECT 1
	FROM blob_links_with_types bl
	JOIN public_blobs pb ON pb.id = bl.source
	JOIN blob_visibility_rules bvr
	 	ON (bvr.source_type = bl.source_type OR bvr.source_type = '*')
		AND (bvr.link_type = bl.link_type OR bvr.link_type = '*')
		AND (bvr.target_type = bl.target_type OR bvr.target_type = '*')
	WHERE bl.target = :new_blob_id
	UNION ALL
	SELECT 1 FROM public_blobs WHERE id = :new_blob_id;
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
		WHERE bl.target NOT IN public_blobs
	)
	INSERT OR IGNORE INTO public_blobs (id)
	SELECT id FROM propagate;
`)

func markBlobPublic(conn *sqlite.Conn, blobID int64) (inserted bool, err error) {
	rows, discard, check := sqlitex.Query(conn, qMarkBlobPublic(), blobID).All()
	defer discard(&err)
	// The INSERT OR IGNORE with RETURNING clause only returns when the row was actually inserted.
	// If the value was already there, nothing gets returned.
	for range rows {
		inserted = true
		break
	}
	err = check()
	return inserted, err
}

var qMarkBlobPublic = dqb.Str(`
	INSERT OR IGNORE INTO public_blobs
	VALUES (:id)
	RETURNING id
`)
