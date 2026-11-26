package blob

import (
	"crypto/sha256"
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

// The latest-text lookups return the text of the most recently indexed
// non-empty occurrence of the block. fts_index_by_genesis_block and
// fts_index_by_blob end in the occurrence ID, so within one genesis (or blob)
// the reverse scan stops at the first hit without a sort.
var qFTSLatestTextByGenesis = dqb.Str(`
	SELECT text
	FROM fts_index INDEXED BY fts_index_by_genesis_block
	WHERE genesis_blob = ?
	AND block_id = ?
	AND text IS NOT NULL
	ORDER BY id DESC
	LIMIT 1
`)

var qFTSLatestTextByBlobID = dqb.Str(`
	SELECT text
	FROM fts_index INDEXED BY fts_index_by_blob
	WHERE blob_id = ?
	AND block_id = ?
	AND text IS NOT NULL
	ORDER BY id DESC
	LIMIT 1
`)

// dbFTSLatestText returns the full-text row of a block's latest non-empty
// indexed content within the document identified by its genesis multihash (or,
// when that is empty, within the given blob), or 0 if it has none.
func dbFTSLatestText(conn *sqlite.Conn, blobID int64, blockID, genesisMultihash string) (text int64, err error) {
	q, args := qFTSLatestTextByBlobID(), []any{blobID, blockID}

	if strings.TrimSpace(genesisMultihash) != "" {
		genesisID, err := dbGenesisID(conn, genesisMultihash)
		if err != nil {
			return 0, err
		}

		q, args = qFTSLatestTextByGenesis(), []any{genesisID, blockID}
	}

	if err := sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
		text = stmt.ColumnInt64(0)
		return nil
	}, args...); err != nil {
		return 0, fmt.Errorf("failed query: FTSLatestText: %w", err)
	}

	return text, nil
}

func dbGenesisID(conn *sqlite.Conn, genesisMultihash string) (id int64, err error) {
	if err := sqlitex.Exec(conn, qGetGenesisID(), func(stmt *sqlite.Stmt) error {
		id = stmt.ColumnInt64(0)
		return nil
	}, strings.ToUpper(genesisMultihash)); err != nil {
		return 0, fmt.Errorf("failed query: qGetGenesisID: %w", err)
	}

	return id, nil
}

// dbFTSInsertOrReplace records an occurrence of content, indexing the content
// itself only if no occurrence of the same text was indexed before. Empty
// content records an occurrence with no text, which marks a deleted block.
func dbFTSInsertOrReplace(conn *sqlite.Conn, content, ftsType string, blobID int64, blockID, version string, ts time.Time, genesisMultihash string) error {
	var text int64

	if content != "" {
		var err error

		text, err = dbFTSEnsureText(conn, content)
		if err != nil {
			return err
		}
	}

	return dbFTSInsertOccurrence(conn, text, ftsType, blobID, blockID, version, ts, genesisMultihash)
}

// dbFTSEnsureText returns the full-text row holding content, inserting it if
// no row holds the same text yet.
func dbFTSEnsureText(conn *sqlite.Conn, content string) (text int64, err error) {
	hash := sha256.Sum256([]byte(content))

	if err := sqlitex.Exec(conn, qFTSTextByHash(), func(stmt *sqlite.Stmt) error {
		text = stmt.ColumnInt64(0)
		return nil
	}, hash[:]); err != nil {
		return 0, fmt.Errorf("failed query: FTSTextByHash: %w", err)
	}

	if text != 0 {
		return text, nil
	}

	if err := sqlitex.Exec(conn, qFTSInsert(), nil, content); err != nil {
		return 0, fmt.Errorf("failed query: FTSInsert: %w", err)
	}

	text = conn.LastInsertRowID()

	if err := sqlitex.Exec(conn, qFTSTextInsert(), nil, text, hash[:]); err != nil {
		return 0, fmt.Errorf("failed query: FTSTextInsert: %w", err)
	}

	return text, nil
}

// dbFTSInsertOccurrence records that the full-text row text (0 for empty
// content) occurs in a blob, block and version.
func dbFTSInsertOccurrence(conn *sqlite.Conn, text int64, ftsType string, blobID int64, blockID, version string, ts time.Time, genesisMultihash string) error {
	genesisID := blobID

	if genesisMultihash != "" {
		var err error

		genesisID, err = dbGenesisID(conn, genesisMultihash)
		if err != nil {
			return err
		}
	}

	var textArg any // NULL for empty content.

	if text != 0 {
		textArg = text
	}

	if err := sqlitex.Exec(conn, qFTSIndexInsert(), nil, textArg, ftsType, blobID, blockID, version, ts.UnixMilli(), genesisID); err != nil {
		return fmt.Errorf("failed query: FTSIndexInsert: %w", err)
	}

	return nil
}

var qGetGenesisID = dqb.Str(`
SELECT id FROM blobs
WHERE multihash = unhex(?)
LIMIT 1;
`)

var qFTSTextByHash = dqb.Str(`
	SELECT id FROM fts_texts WHERE hash = ?;
`)

var qFTSInsert = dqb.Str(`
	INSERT INTO fts (raw_content) VALUES (?);
`)

var qFTSTextInsert = dqb.Str(`
	INSERT INTO fts_texts (id, hash) VALUES (?, ?);
`)

var qFTSIndexInsert = dqb.Str(`
	INSERT INTO fts_index (text, type, blob_id, block_id, version, ts, genesis_blob)
	VALUES (?, ?, ?, ?, ?, ?, ?);
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

func dbBlobsGetSize(conn *sqlite.Conn, blobsMultihash []byte, serverMode bool) (blobsGetSizeResult, error) {
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

	if serverMode {
		err := sqlitegen.ExecStmt(conn, qBlobsGetSizePublic(), before, onStep)
		if err != nil {
			err = fmt.Errorf("failed query: BlobsGetSizePublic: %w", err)
		}
		return out, err
	}

	err := sqlitegen.ExecStmt(conn, qBlobsGetSizeAll(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsGetSize: %w", err)
	}

	return out, err
}

var qBlobsGetSizePublic = dqb.Str(`
	SELECT
		blobs.id,
		blobs.size
	FROM blobs INDEXED BY blobs_metadata_by_hash
	JOIN public_blobs ON blobs.id = public_blobs.id
	WHERE blobs.multihash = :blobsMultihash
`)

var qBlobsGetSizeAll = dqb.Str(`
	SELECT
		blobs.id,
		blobs.size
	FROM blobs INDEXED BY blobs_metadata_by_hash
	WHERE blobs.multihash = :blobsMultihash
`)

func dbBlobsGetGenesis(conn *sqlite.Conn, id int64) (genesis int64, err error) {
	rows, discard, check := sqlitex.Query(conn, qBlobsGetGenesis(), id).All()
	defer discard(&err)
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
