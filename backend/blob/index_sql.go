package blob

import (
	"errors"
	"fmt"
	"seed/backend/util/dqb"
	"seed/backend/util/maybe"
	"seed/backend/util/sqlitegen"
	"strings"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
)

// dbStructuralBlobsInsert inserts a structural blob.
func dbStructuralBlobsInsert(conn *sqlite.Conn, id int64, blobType string, author, genesis, resource, ts maybe.Value[int64], meta maybe.Value[[]byte]) error {
	if id == 0 {
		return fmt.Errorf("must specify blob ID")
	}

	return sqlitex.Exec(conn, qStructuralBlobsInsert(), nil, id, blobType, author.Any(), genesis.Any(), resource.Any(), ts.Any(), meta.Any())
}

var qStructuralBlobsInsert = dqb.Str(`
	INSERT INTO structural_blobs (id, type, author, genesis_blob, resource, ts, extra_attrs)
	VALUES (?, ?, ?, ?, ?, ?, ?);
`)

func dbBlobLinksInsertOrIgnore(conn *sqlite.Conn, blobLinksSource int64, blobLinksType string, blobLinksTarget int64) error {
	before := func(stmt *sqlite.Stmt) {
		stmt.SetInt64(":blobLinksSource", blobLinksSource)
		stmt.SetText(":blobLinksType", blobLinksType)
		stmt.SetInt64(":blobLinksTarget", blobLinksTarget)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobLinksInsertOrIgnore(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobLinksInsertOrIgnore: %w", err)
	}

	return err
}

var qBlobLinksInsertOrIgnore = dqb.Str(`
	INSERT OR IGNORE INTO blob_links (source, type, target)
	VALUES (:blobLinksSource, :blobLinksType, :blobLinksTarget)
`)

func dbFTSInsertOrReplace(conn *sqlite.Conn, FTSContent, FTSType string, FTSBlobID int64, FTSBlockID, FTSVersion string, FTSTs time.Time, FTSGenesisMultihash string) error {
	before := func(stmt *sqlite.Stmt) {
		stmt.SetText(":FTSContent", FTSContent)
		stmt.SetText(":FTSType", FTSType)
		stmt.SetInt64(":FTSBlobID", FTSBlobID)
		stmt.SetText(":FTSBlockID", FTSBlockID)
		stmt.SetText(":FTSVersion", FTSVersion)
	}

	onStep := func(_ int, _ *sqlite.Stmt) error {
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qFTSInsert(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: FTSInsert: %w", err)
		return err
	}
	lastRowID := conn.LastInsertRowID()
	var genesisID int64
	if FTSGenesisMultihash != "" {
		before = func(stmt *sqlite.Stmt) {
			stmt.SetText(":FTSMultihash", strings.ToUpper(FTSGenesisMultihash))
		}

		err = sqlitegen.ExecStmt(conn, qGetGenesisId(), before, func(_ int, stmt *sqlite.Stmt) error {
			genesisID = stmt.ColumnInt64(0)
			return nil
		})
		if err != nil {
			err = fmt.Errorf("failed query: qGetGenesisId: %w", err)
			return err
		}
	} else {
		genesisID = FTSBlobID
	}
	before = func(stmt *sqlite.Stmt) {
		stmt.SetText(":FTSType", FTSType)
		stmt.SetInt64(":FTSBlobID", FTSBlobID)
		stmt.SetText(":FTSBlockID", FTSBlockID)
		stmt.SetText(":FTSVersion", FTSVersion)
		stmt.SetInt64(":FTSRowID", lastRowID)
		stmt.SetInt64(":FTSTs", FTSTs.UnixMilli())
		stmt.SetInt64(":FTSGenesisBlob", genesisID)
	}

	err = sqlitegen.ExecStmt(conn, qFTSIndexInsert(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: FTSIndexInsert: %w", err)
		return err
	}
	/*
		rowsToUpdate := []int64{1, 45, 1034, 56, 467, 832, 11023}

		before = func(stmt *sqlite.Stmt) {
			stmt.SetText(":FTSMultihash", FTSGenesisHash)
		}
		var genesisID int64
		onStep = func(_ int, stmt *sqlite.Stmt) error {
			genesisID = stmt.ColumnInt64(0)
			return nil
		}
		genesisID++

			err = sqlitegen.ExecStmt(conn, qGetDocumentBlobs(), before, onStep)
			if err != nil {
				err = fmt.Errorf("failed query: FTSCheck: %w", err)
				return err
			}

		before = func(stmt *sqlite.Stmt) {
			stmt.SetText(":FTSType", FTSType)
			stmt.SetInt64(":FTSBlobID", FTSBlobID)
			stmt.SetText(":DocBlobIDs", strconv.FormatInt(genesisID, 10))
		}

		onStep = func(_ int, stmt *sqlite.Stmt) error {
			rowsToUpdate = append(rowsToUpdate, stmt.ColumnInt64(0))
			return nil
		}

		err = sqlitegen.ExecStmt(conn, qFTSCheck(), before, onStep)
		if err != nil {
			err = fmt.Errorf("failed query: FTSCheck: %w", err)
			return err
		}

		var idx int
		if len(rowsToUpdate) > 0 {
			//fmt.Println("FTSUpdate: updating", len(rowsToUpdate), "rows")
			before := func(stmt *sqlite.Stmt) {
				stmt.SetInt64(":FTSBlobID", FTSBlobID)
				stmt.SetInt64(":FTSRowID", rowsToUpdate[idx])
				stmt.SetText(":FTSVersion", FTSVersion)
				idx++
			}

			onStep := func(_ int, _ *sqlite.Stmt) error {
				return nil
			}
			err = sqlitegen.ExecStmt(conn, qFTSUpdate(), before, onStep)
			if err != nil {
				err = fmt.Errorf("failed query: FTSUpdate: %w", err)
				return err
			}
		}
	*/
	return nil
}

var qGetGenesisId = dqb.Str(`
SELECT id FROM blobs
WHERE multihash = unhex(:FTSMultihash)
LIMIT 1;
`)

var qFTSRecursiveCheck = dqb.Str(`
WITH RECURSIVE 
genesis_id AS (
	SELECT 
	id
	FROM blobs
	WHERE lower(hex(multihash)) = :FTSMultihash
	LIMIT 1
)
relevant_cols AS (
	SELECT 
	fts_index.version,
	fts_index.blob_id,
	fts_type
	FROM fts_index
	JOIN structural_blobs ON fts_index.blob_id = structural_blobs.id
	WHERE type IN ('document', 'title')
	AND genesis_blob = (SELECT id FROM genesis_id)
),
nodes(rowid, ) AS (
   VALUES(:FTSBlobID)
   UNION ALL
   SELECT blob_id, block_id FROM fts_index JOIN nodes ON blob_id=bid
   WHERE blob_id >
)
SELECT x FROM nodes;
`)

var qFTSCheck = dqb.Str(`
    SELECT
		rowid
    FROM fts_index
	WHERE
	(
		:FTSType = 'document'
	    AND type != :FTSType
	) OR (
		block_id != :FTSBlockID
		AND (type = 'document' AND type = :FTSType)
		AND blob_id  < :FTSBlobID
		AND blob_id IN (:DocBlobIDs)
	) OR (
		(type = 'title' AND type = :FTSType)
		AND blob_id NOT IN (:DocBlobIDs)
	)
`)

var qFTSCheckFast = dqb.Str(`
    SELECT
		rowid,
		type,
		blob_id
    FROM fts_index
	WHERE type = 'document' OR type = 'title'
`)

var qFTSUpdate = dqb.Str(`
    UPDATE fts
    SET
      blob_id = :FTSBlobID,
      version = :FTSVersion
    WHERE
      rowid = :FTSRowID
`)

var qFTSInsert = dqb.Str(`
	INSERT OR REPLACE INTO fts(raw_content, type, blob_id, block_id, version)
	VALUES (:FTSContent, :FTSType, :FTSBlobID, :FTSBlockID, :FTSVersion)
`)

var qFTSIndexInsert = dqb.Str(`
	INSERT OR REPLACE INTO fts_index(rowid, type, blob_id, block_id, version, ts, genesis_blob)
	VALUES (:FTSRowID, :FTSType, :FTSBlobID, :FTSBlockID, :FTSVersion, :FTSTs, :FTSGenesisBlob)
`)

func dbResourceLinksInsert(conn *sqlite.Conn, sourceBlob, targetResource int64, ltype string, isPinned bool, meta []byte) error {
	return sqlitex.Exec(conn, qResourceLinksInsert(), nil, sourceBlob, targetResource, ltype, isPinned, maybe.AnySlice(meta))
}

var qResourceLinksInsert = dqb.Str(`
	INSERT INTO resource_links (source, target, type, is_pinned, extra_attrs)
	VALUES (?, ?, ?, ?, ?);
`)

type blobsGetSizeResult struct {
	BlobsID   int64
	BlobsSize int64
}

func dbBlobsGetSize(conn *sqlite.Conn, blobsMultihash []byte) (blobsGetSizeResult, error) {
	var out blobsGetSizeResult

	before := func(stmt *sqlite.Stmt) {
		stmt.SetBytes(":blobsMultihash", blobsMultihash)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("BlobsGetSize: more than one result return for a single-kind query")
		}

		out.BlobsID = stmt.ColumnInt64(0)
		out.BlobsSize = stmt.ColumnInt64(1)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobsGetSize(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsGetSize: %w", err)
	}

	return out, err
}

var qBlobsGetSize = dqb.Str(`
	SELECT blobs.id, blobs.size
	FROM blobs INDEXED BY blobs_metadata_by_hash
	WHERE blobs.multihash = :blobsMultihash
`)

func dbBlobsGetGenesis(conn *sqlite.Conn, id int64) (genesis int64, err error) {
	rows, check := sqlitex.Query(conn, qBlobsGetGenesis(), id)
	for row := range rows {
		genesis = row.ColumnInt64(0)
	}
	if err := check(); err != nil {
		return 0, err
	}

	return genesis, nil
}

var qBlobsGetGenesis = dqb.Str(`
	SELECT COALESCE(genesis_blob, id)
	FROM structural_blobs
	WHERE id = :id
	LIMIT 1;
`)

// DbPublicKeysLookupID gets the db index of a given account.
func DbPublicKeysLookupID(conn *sqlite.Conn, publicKeysPrincipal []byte) (int64, error) {
	before := func(stmt *sqlite.Stmt) {
		stmt.SetBytes(":publicKeysPrincipal", publicKeysPrincipal)
	}

	var out int64

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("PublicKeysLookupID: more than one result return for a single-kind query")
		}

		out = stmt.ColumnInt64(0)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qPublicKeysLookupID(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: PublicKeysLookupID: %w", err)
	}

	return out, err
}

var qPublicKeysLookupID = dqb.Str(`
	SELECT public_keys.id
	FROM public_keys
	WHERE public_keys.principal = :publicKeysPrincipal
	LIMIT 1
`)

// DbGetPublicKeyByID gets the account given its db Index.
func DbGetPublicKeyByID(conn *sqlite.Conn, id int64) (publicKeysPrincipal []byte, err error) {
	before := func(stmt *sqlite.Stmt) {
		stmt.SetInt64(":publicKeysID", id)
	}

	var out []byte

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("GetPublicKeyByID: more than one result return for a single-kind query")
		}

		out = stmt.ColumnBytes(0)
		return nil
	}

	err = sqlitegen.ExecStmt(conn, qGetPublicKeyByID(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: GetPublicKeyByID: %w", err)
	}

	return out, err
}

var qGetPublicKeyByID = dqb.Str(`
	SELECT public_keys.principal
	FROM public_keys
	WHERE public_keys.id = :publicKeysID
	LIMIT 1
`)

// DbPublicKeysInsert inserts the provided account in the db.
func DbPublicKeysInsert(conn *sqlite.Conn, principal []byte) (int64, error) {
	var out int64

	before := func(stmt *sqlite.Stmt) {
		stmt.SetBytes(":principal", principal)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("PublicKeysInsert: more than one result return for a single-kind query")
		}

		out = stmt.ColumnInt64(0)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qPublicKeysInsert(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: PublicKeysInsert: %w", err)
	}

	return out, err
}

var qPublicKeysInsert = dqb.Str(`
	INSERT INTO public_keys (principal)
	VALUES (:principal)
	RETURNING public_keys.id AS public_keys_id
`)

func dbBlobsInsert(conn *sqlite.Conn, blobsID int64, blobsMultihash []byte, blobsCodec int64, blobsData []byte, blobsSize int64) (int64, error) {
	var out int64

	before := func(stmt *sqlite.Stmt) {
		stmt.SetInt64(":blobsID", blobsID)
		stmt.SetBytes(":blobsMultihash", blobsMultihash)
		stmt.SetInt64(":blobsCodec", blobsCodec)
		stmt.SetBytes(":blobsData", blobsData)
		stmt.SetInt64(":blobsSize", blobsSize)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("BlobsInsert: more than one result return for a single-kind query")
		}

		out = stmt.ColumnInt64(0)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobsInsert(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsInsert: %w", err)
	}

	return out, err
}

var qBlobsInsert = dqb.Str(`
	INSERT INTO blobs (id, multihash, codec, data, size)
	VALUES (NULLIF(:blobsID, 0), :blobsMultihash, :blobsCodec, :blobsData, :blobsSize)
	RETURNING blobs.id;
`)

type entitiesLookupIDResult struct {
	ResourcesID    int64
	ResourcesOwner int64
}

func dbResourcesLookupID(conn *sqlite.Conn, iri string) (entitiesLookupIDResult, error) {
	var out entitiesLookupIDResult

	before := func(stmt *sqlite.Stmt) {
		stmt.SetText(":entities_eid", iri)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("EntitiesLookupID: more than one result return for a single-kind query")
		}

		out.ResourcesID = stmt.ColumnInt64(0)
		out.ResourcesOwner = stmt.ColumnInt64(1)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qEntitiesLookupID(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: EntitiesLookupID: %w", err)
	}

	return out, err
}

var qEntitiesLookupID = dqb.Str(`
	SELECT resources.id, resources.owner
	FROM resources
	WHERE resources.iri = :entities_eid
	LIMIT 1
`)

func dbEntitiesInsertOrIgnore(conn *sqlite.Conn, entity_id string) (int64, error) {
	var out int64

	before := func(stmt *sqlite.Stmt) {
		stmt.SetText(":entity_id", entity_id)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("EntitiesInsertOrIgnore: more than one result return for a single-kind query")
		}

		out = stmt.ColumnInt64(0)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qEntitiesInsertOrIgnore(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: EntitiesInsertOrIgnore: %w", err)
	}

	return out, err
}

var qEntitiesInsertOrIgnore = dqb.Str(`
	INSERT OR IGNORE INTO resources (iri)
	VALUES (:entity_id)
	RETURNING resources.id AS entities_id
`)

func dbResourcesMaybeSetOwner(conn *sqlite.Conn, id, owner int64) (updated bool, err error) {
	if id == 0 {
		return false, fmt.Errorf("must specify resource ID")
	}

	if owner == 0 {
		return false, fmt.Errorf("must specify owner ID")
	}

	if err := sqlitex.Exec(conn, qResourcesMaybeSetOwner(), nil, owner, id); err != nil {
		return false, err
	}

	return conn.Changes() > 0, nil
}

var qResourcesMaybeSetOwner = dqb.Str(`
	UPDATE resources
	SET owner = ?
	WHERE id = ?
	AND owner IS NULL;
`)

func dbResourcesMaybeSetTimestamp(conn *sqlite.Conn, id, ts int64) (updated bool, err error) {
	if id == 0 {
		return false, fmt.Errorf("must specify resource ID")
	}

	if err := sqlitex.Exec(conn, qResourcesMaybeSetTimestamp(), nil, ts, id); err != nil {
		return false, err
	}

	return conn.Changes() > 0, nil
}

var qResourcesMaybeSetTimestamp = dqb.Str(`
	UPDATE resources
	SET create_time = ?
	WHERE id = ?
	AND create_time IS NULL;
`)

func dbResourcesMaybeSetGenesis(conn *sqlite.Conn, id, genesis int64) (updated bool, err error) {
	if id == 0 {
		return false, fmt.Errorf("must specify resource ID")
	}

	if genesis == 0 {
		return false, fmt.Errorf("must specify timestamp")
	}

	if err := sqlitex.Exec(conn, qResourcesMaybeSetGenesis(), nil, genesis, id); err != nil {
		return false, err
	}

	return conn.Changes() > 0, nil
}

var qResourcesMaybeSetGenesis = dqb.Str(`
	UPDATE resources
	SET genesis_blob = ?
	WHERE id = ?
	AND create_time IS NULL;
`)

func dbBlobsDelete(conn *sqlite.Conn, blobsMultihash []byte) (int64, error) {
	var out int64

	before := func(stmt *sqlite.Stmt) {
		stmt.SetBytes(":blobsMultihash", blobsMultihash)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("BlobsDelete: more than one result return for a single-kind query")
		}

		out = stmt.ColumnInt64(0)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobsDelete(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsDelete: %w", err)
	}

	return out, err
}

var qBlobsDelete = dqb.Str(`
	DELETE FROM blobs
	WHERE blobs.multihash = :blobsMultihash
	RETURNING blobs.id
`)

type blobsListKnownResult struct {
	BlobsID        int64
	BlobsMultihash []byte
	BlobsCodec     int64
}

func dbBlobsListKnown(conn *sqlite.Conn) ([]blobsListKnownResult, error) {
	var out []blobsListKnownResult

	before := func(stmt *sqlite.Stmt) {
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		out = append(out, blobsListKnownResult{
			BlobsID:        stmt.ColumnInt64(0),
			BlobsMultihash: stmt.ColumnBytes(1),
			BlobsCodec:     stmt.ColumnInt64(2),
		})

		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobsListKnown(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsListKnown: %w", err)
	}

	return out, err
}

var qBlobsListKnown = dqb.Str(`
	SELECT blobs.id, blobs.multihash, blobs.codec
	FROM blobs INDEXED BY blobs_metadata
	-- LEFT JOIN drafts ON drafts.blob = blobs.id
	WHERE blobs.size >= 0
	-- AND drafts.blob IS NULL
	ORDER BY blobs.id
`)

type blobsGetResult struct {
	BlobsID        int64
	BlobsMultihash []byte
	BlobsCodec     int64
	BlobsData      []byte
	BlobsSize      int64
}

func dbBlobsGet(conn *sqlite.Conn, blobsMultihash []byte) (blobsGetResult, error) {
	var out blobsGetResult

	before := func(stmt *sqlite.Stmt) {
		stmt.SetBytes(":blobsMultihash", blobsMultihash)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("BlobsGet: more than one result return for a single-kind query")
		}

		out.BlobsID = stmt.ColumnInt64(0)
		out.BlobsMultihash = stmt.ColumnBytes(1)
		out.BlobsCodec = stmt.ColumnInt64(2)
		out.BlobsData = stmt.ColumnBytes(3)
		out.BlobsSize = stmt.ColumnInt64(4)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobsGet(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsGet: %w", err)
	}

	return out, err
}

var qBlobsGet = dqb.Str(`
	SELECT blobs.id, blobs.multihash, blobs.codec, blobs.data, blobs.size
	FROM blobs
	WHERE blobs.multihash = :blobsMultihash AND blobs.size >= 0
`)

func dbSetReindexTime(conn *sqlite.Conn, kvValue string) error {
	const query = `INSERT OR REPLACE INTO kv (key, value)
VALUES ('last_reindex_time', :kvValue)
`

	before := func(stmt *sqlite.Stmt) {
		stmt.SetText(":kvValue", kvValue)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		return nil
	}

	err := sqlitegen.ExecStmt(conn, query, before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: SetReindexTime: %w", err)
	}

	return err
}

func dbGetReindexTime(conn *sqlite.Conn) (string, error) {
	const query = `SELECT kv.value
FROM kv
WHERE kv.key = 'last_reindex_time'
LIMIT 1`

	var out string

	before := func(stmt *sqlite.Stmt) {
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("GetReindexTime: more than one result return for a single-kind query")
		}

		out = stmt.ColumnText(0)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, query, before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: GetReindexTime: %w", err)
	}

	return out, err
}
