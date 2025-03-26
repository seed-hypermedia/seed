package blob

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/btree"
	"seed/backend/util/dqb"
	"seed/backend/util/maybe"
	"seed/backend/util/strbytes"
	"slices"
	"strings"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	blockstore "github.com/ipfs/boxo/blockstore"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var errNotHyperBlob = errors.New("not a hyper blob")

type IRI string

// NewIRI creates a new IRI from account and path.
func NewIRI(account core.Principal, path string) (IRI, error) {
	if path != "" {
		if path[0] != '/' {
			return "", fmt.Errorf("path must start with a slash: %s", path)
		}

		if path[len(path)-1] == '/' {
			return "", fmt.Errorf("path must not end with a slash: %s", path)
		}
	}

	return IRI("hm://" + account.String() + path), nil
}

// SpacePath parses IRI into space+path tuple if possible.
func (iri IRI) SpacePath() (space core.Principal, path string, err error) {
	u, err := url.Parse(string(iri))
	if err != nil {
		return nil, "", err
	}

	space, err = core.DecodePrincipal(u.Host)
	if err != nil {
		return nil, "", err
	}

	return space, u.Path, nil
}

// Breadcrumbs returns a list of IRIs for each parent of the IRI (including the original one at the end).
func (iri IRI) Breadcrumbs() []IRI {
	if !strings.HasPrefix(string(iri), "hm://") {
		panic("BUG: calling Breadcrumbs on a non-hypermedia IRI")
	}

	components := strings.Count(string(iri), "/")
	if components > 0 {
		components -= 2 // Don't count the 2 slashes from hm:// part.
	}

	out := make([]IRI, 0, components+1) // +1 to account for the final result of the original IRI.
	// Starting from 5 to skip the hm:// part.
	for i := 5; i < len(iri); i++ {
		if iri[i] == '/' {
			out = append(out, IRI(iri[:i]))
		}
	}
	out = append(out, iri)

	return out
}

type Index struct {
	bs  *blockStore
	db  *sqlitex.Pool
	log *zap.Logger
}

// OpenIndex creates the index and reindexes the data if necessary.
// At some point we should probably make the reindexing a separate concern.
func OpenIndex(ctx context.Context, db *sqlitex.Pool, log *zap.Logger) (*Index, error) {
	idx := &Index{
		bs:  newBlockstore(db),
		db:  db,
		log: log,
	}

	if err := idx.MaybeReindex(ctx); err != nil {
		return nil, err
	}

	return idx, nil
}

func (idx *Index) IPFSBlockstore() blockstore.Blockstore {
	return idx.bs
}

// indexBlob is an uber-function that knows about all types of blobs we want to index.
// This is probably a bad idea to put here, but for now it's easier to work with that way.
// TODO(burdiyan): eventually we might want to make this package agnostic to blob types.
func (idx *Index) indexBlob(trackUnreads bool, conn *sqlite.Conn, id int64, c cid.Cid, data []byte) (err error) {
	return indexBlob(trackUnreads, conn, id, c, data, idx.bs, idx.log)
}

func indexBlob(trackUnreads bool, conn *sqlite.Conn, id int64, c cid.Cid, data []byte, bs *blockStore, log *zap.Logger) (err error) {
	defer sqlitex.Save(conn)(&err)

	ictx := newCtx(conn, id, bs, log)
	ictx.mustTrackUnreads = trackUnreads
	if err := ictx.Unstash(); err != nil {
		return err
	}

	for _, fn := range indexersList {
		if err := fn(ictx, id, c, data); err != nil {
			return err
		}
	}

	return err
}

// CanEditResource checks whether author can edit the resource.
func (idx *Index) CanEditResource(ctx context.Context, resource IRI, author core.Principal) (ok bool, err error) {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return ok, err
	}
	defer release()

	res, err := dbResourcesLookupID(conn, string(resource))
	if err != nil {
		return ok, err
	}
	if res.ResourcesID == 0 {
		return ok, status.Errorf(codes.NotFound, "resource %s not found", resource)
	}

	dbAuthor, err := DbPublicKeysLookupID(conn, author)
	if err != nil {
		return ok, err
	}
	if dbAuthor == 0 {
		return ok, status.Errorf(codes.NotFound, "author %s not found", author)
	}

	return res.ResourcesOwner == dbAuthor, nil
}

type ChangeRecord struct {
	CID        cid.Cid
	Data       *Change
	Generation int64
}

// iterChangesLatest iterates over changes for a given resource for the latest generation.
func (idx *Index) iterChangesLatest(ctx context.Context, resource IRI) (it iter.Seq[ChangeRecord], check func() error) {
	var outErr error

	check = func() error { return outErr }

	it = func(yield func(ChangeRecord) bool) {
		conn, release, err := idx.db.Conn(ctx)
		if err != nil {
			outErr = err
			return
		}
		defer release()

		generations, err := idx.loadGenerations(conn, resource)
		if err != nil {
			outErr = err
			return
		}

		if len(generations) == 0 {
			return
		}

		maxRef := generations[0]

		if maxRef.IsTombstone {
			outErr = status.Errorf(codes.FailedPrecondition, "document '%s' is marked as deleted", resource)
			return
		}

		var heads []int64
		for i, gen := range generations {
			// We only take into account those Refs that coincide with the latest generation and genesis.
			if i > 0 && (gen.GenesisID != maxRef.GenesisID || gen.Generation != maxRef.Generation) {
				continue
			}

			heads = append(heads, gen.Heads...)
		}

		slices.Sort(heads)
		heads = slices.Compact(heads)

		headJSON, err := json.Marshal(heads)
		if err != nil {
			outErr = err
			return
		}

		buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
		rows, check := sqlitex.Query(conn, qIterChangesFromHeads(), strbytes.String(headJSON))
		for row := range rows {
			next := sqlite.NewIncrementor(0)
			var (
				codec = row.ColumnInt64(next())
				hash  = row.ColumnBytesUnsafe(next())
				data  = row.ColumnBytesUnsafe(next())
			)

			buf, err = idx.bs.decoder.DecodeAll(data, buf)
			if err != nil {
				outErr = errors.Join(outErr, err)
				break
			}

			chcid := cid.NewCidV1(uint64(codec), hash)
			ch := &Change{}
			if err := cbornode.DecodeInto(buf, ch); err != nil {
				outErr = errors.Join(outErr, fmt.Errorf("WalkChanges: failed to decode change %s for entity %s: %w", chcid, resource, err))
				break
			}

			rec := ChangeRecord{
				CID:        chcid,
				Data:       ch,
				Generation: maxRef.Generation,
			}

			if !yield(rec) {
				break
			}

			buf = buf[:0] // reset the slice reusing the backing array
		}

		outErr = errors.Join(outErr, check())
	}

	return it, check
}

var qIterChangesFromHeads = dqb.Str(`
	WITH RECURSIVE
	changes (id) AS (
		SELECT value FROM json_each(:heads)
		UNION
		SELECT target
		FROM blob_links
		JOIN changes ON changes.id = blob_links.source
			AND blob_links.type = 'change/dep'
	)
	SELECT
		codec,
		multihash,
		data
	FROM changes
	JOIN blobs ON changes.id = blobs.id
	LEFT JOIN structural_blobs ON structural_blobs.id = blobs.id
	ORDER BY structural_blobs.ts;
`)

// IterChanges iterates over changes starting from the given heads.
// When no heads are provided it uses the latest generation and the latest version.
func (idx *Index) IterChanges(ctx context.Context, resource IRI, heads []cid.Cid) (it iter.Seq[ChangeRecord], check func() error) {
	if len(heads) == 0 {
		return idx.iterChangesLatest(ctx, resource)
	}

	var outErr error

	check = func() error { return outErr }

	it = func(yield func(ChangeRecord) bool) {
		conn, release, err := idx.db.Conn(ctx)
		if err != nil {
			outErr = err
			return
		}
		defer release()

		headIDs, err := cidsToDBIDs(conn, heads)
		if err != nil {
			outErr = err
			return
		}

		var versionGenesis int64

		for i, h := range headIDs {
			genesis, err := dbBlobsGetGenesis(conn, h)
			if err != nil {
				outErr = err
				return
			}
			if genesis == 0 {
				outErr = fmt.Errorf("no genesis for change %s", heads[i])
				return
			}

			if versionGenesis == 0 {
				versionGenesis = genesis
			} else if versionGenesis != genesis {
				outErr = fmt.Errorf("changes of compound version %s have different genesis", NewVersion(heads...).String())
				return
			}
		}

		generations, err := idx.loadGenerations(conn, resource)
		if err != nil {
			outErr = err
			return
		}

		if len(generations) == 0 {
			return
		}

		type lineageID struct {
			Generation int64
			GenesisID  int64
		}

		filteredLineages := btree.New[lineageID, []int64](8, func(a, b lineageID) int {
			if a.Generation < b.Generation {
				return -1
			}
			if a.Generation > b.Generation {
				return +1
			}
			return cmp.Compare(a.GenesisID, b.GenesisID)
		})

		for _, gen := range generations {
			if gen.GenesisID != versionGenesis {
				continue
			}

			linID := lineageID{Generation: gen.Generation, GenesisID: gen.GenesisID}

			heads := filteredLineages.GetMaybe(linID)
			heads = append(heads, gen.Heads...)
			filteredLineages.Set(linID, heads)
		}

		if filteredLineages.Len() == 0 {
			return
		}

		var versionGeneration maybe.Value[int64]
	Loop:
		for linID, linHeads := range filteredLineages.Items() {
			graph, err := idx.resolveHeads(conn, linHeads)
			if err != nil {
				outErr = err
				return
			}

			// Check if all of our version components are in the graph.
			// If they are we use this generation, otherwise we skip it.
			for _, h := range headIDs {
				_, ok := slices.BinarySearch(graph, h)
				if ok {
					versionGeneration = maybe.New(linID.Generation)
					break Loop
				}
			}
		}

		if !versionGeneration.IsSet() {
			return
		}

		headsJSON, err := json.Marshal(headIDs)
		if err != nil {
			outErr = err
			return
		}

		buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
		rows, check := sqlitex.Query(conn, qIterChangesFromHeads(), strbytes.String(headsJSON))
		for row := range rows {
			next := sqlite.NewIncrementor(0)
			var (
				codec = row.ColumnInt64(next())
				hash  = row.ColumnBytesUnsafe(next())
				data  = row.ColumnBytesUnsafe(next())
			)

			if len(data) == 0 {
				//nolint:gosec
				outErr = errors.Join(outErr, fmt.Errorf("WalkChanges: empty data for change %s", cid.NewCidV1(uint64(codec), hash)))
				break
			}

			buf, err = idx.bs.decoder.DecodeAll(data, buf)
			if err != nil {
				outErr = errors.Join(outErr, err)
				break
			}

			//nolint:gosec
			chcid := cid.NewCidV1(uint64(codec), hash)
			ch := &Change{}
			if err := cbornode.DecodeInto(buf, ch); err != nil {
				outErr = errors.Join(outErr, fmt.Errorf("WalkChanges: failed to decode change %s: %w", chcid, err))
				break
			}

			rec := ChangeRecord{
				CID:        chcid,
				Data:       ch,
				Generation: versionGeneration.Value(),
			}

			if !yield(rec) {
				break
			}

			buf = buf[:0] // reset the slice reusing the backing array
		}

		outErr = errors.Join(outErr, check())
	}

	return it, check
}

func (idx *Index) resolveHeads(conn *sqlite.Conn, heads []int64) ([]int64, error) {
	if len(heads) == 0 {
		return nil, fmt.Errorf("BUG: heads must not be empty")
	}

	idsJSON, err := json.Marshal(heads)
	if err != nil {
		return nil, err
	}

	var out []int64
	rows, check := sqlitex.Query(conn, qResolveHeads(), strbytes.String(idsJSON))
	for row := range rows {
		out = append(out, row.ColumnInt64(0))
	}
	if err := check(); err != nil {
		return nil, err
	}

	return out, nil
}

var qResolveHeads = dqb.Str(`
	WITH RECURSIVE
	changes (id) AS (
		SELECT value FROM json_each(:heads)
		UNION
		SELECT target
		FROM blob_links
		JOIN changes ON changes.id = blob_links.source
		WHERE type = 'change/dep'
	)
	SELECT id FROM changes
	ORDER BY id;
`)

func cidsToDBIDs(conn *sqlite.Conn, cids []cid.Cid) ([]int64, error) {
	if len(cids) == 0 {
		return nil, fmt.Errorf("cids must not be empty")
	}

	out := make([]int64, len(cids))
	for i, c := range cids {
		res, err := dbBlobsGetSize(conn, c.Hash())
		if err != nil {
			return nil, err
		}
		if res.BlobsSize < 0 || res.BlobsID == 0 {
			return nil, fmt.Errorf("cid %s not found", c)
		}

		out[i] = res.BlobsID
	}

	return out, nil
}

func (idx *Index) loadGenerations(conn *sqlite.Conn, resource IRI) (out []generation, err error) {
	rows, check := sqlitex.Query(conn, qLoadGenerations(), resource, resource)
	for row := range rows {
		seq := sqlite.NewIncrementor(0)
		g := generation{
			RefID:      row.ColumnInt64(seq()),
			Generation: row.ColumnInt64(seq()),
			GenesisID:  row.ColumnInt64(seq()),
			AuthorID:   row.ColumnInt64(seq()),
			Ts:         row.ColumnInt64(seq()),
		}

		isTomb := row.ColumnInt64(seq())
		if isTomb != 0 && isTomb != 1 {
			err = fmt.Errorf("BUG: invalid tombstone value %v", isTomb)
			break
		}

		g.IsTombstone = isTomb == 1

		if xerr := json.Unmarshal(row.ColumnBytesUnsafe(seq()), &g.Heads); xerr != nil {
			err = fmt.Errorf("BUG: failed to unmarshal JSON heads: %w", xerr)
			break
		}

		out = append(out, g)
	}

	err = errors.Join(err, check())
	if err != nil {
		return nil, err
	}

	return out, nil
}

type generation struct {
	RefID       int64
	Generation  int64
	GenesisID   int64
	AuthorID    int64
	Ts          int64
	IsTombstone bool
	Heads       []int64
}

// TODO: check caps for all parent docs explicitly, instead of relying on prefix matching,
// because prefix matching doesn't know anything about hierarchical path structure,
// and just matches strings naively, which may cause correctness issues.
var qLoadGenerations = dqb.Str(`
	WITH RECURSIVE
	space (id, owner) AS (
		SELECT id, owner FROM resources WHERE iri = :iri
		LIMIT 1
	),
	authors (id) AS (
		SELECT owner FROM space
		UNION
		SELECT extra_attrs->>'del'
		FROM structural_blobs
		WHERE type = 'Capability'
		AND author = (SELECT owner FROM space LIMIT 1)
		AND resource IN (SELECT id FROM resources WHERE :iri2 BETWEEN iri AND iri || '~~~~~~')
	),
	refs (id, generation, genesis, author, ts, is_tombstone, heads) AS (
		SELECT
			structural_blobs.id,
			COALESCE(extra_attrs->>'generation', 0) AS generation,
			genesis_blob,
			author,
			ts,
			COALESCE(extra_attrs->>'tombstone', 0) AS is_tombstone,
			JSON_GROUP_ARRAY(blob_links.target) AS heads
		FROM structural_blobs
		JOIN space ON space.id = structural_blobs.resource
		JOIN authors ON authors.id = structural_blobs.author
		LEFT JOIN blob_links ON blob_links.source = structural_blobs.id AND blob_links.type = 'ref/head'
		WHERE structural_blobs.type = 'Ref'
		GROUP BY generation, genesis_blob, author
		HAVING ts = MAX(ts)
	)
	SELECT refs.*
	FROM refs
	ORDER BY refs.generation DESC, refs.ts DESC;
`)

func (idx *Index) WalkCapabilities(ctx context.Context, resource IRI, author core.Principal, fn func(cid.Cid, *Capability) error) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
	if err := sqlitex.Exec(conn, qWalkCapabilities(), func(stmt *sqlite.Stmt) error {
		var (
			codec = stmt.ColumnInt64(0)
			hash  = stmt.ColumnBytesUnsafe(1)
			data  = stmt.ColumnBytesUnsafe(2)
		)

		buf, err = idx.bs.decoder.DecodeAll(data, buf)
		if err != nil {
			return err
		}

		chcid := cid.NewCidV1(uint64(codec), hash)
		cpb := &Capability{}
		if err := cbornode.DecodeInto(buf, cpb); err != nil {
			return fmt.Errorf("WalkChanges: failed to decode change %s for entity %s: %w", chcid, resource, err)
		}

		if err := fn(chcid, cpb); err != nil {
			return err
		}

		buf = buf[:0] // reset the slice reusing the backing array

		return nil
	}, resource, author); err != nil {
		return err
	}

	return nil
}

var qWalkCapabilities = dqb.Str(`
	SELECT
		b.codec,
		b.multihash,
		b.data
	FROM structural_blobs sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.type = 'Capability'
	AND sb.resource IN (SELECT id FROM resources WHERE :iri BETWEEN iri AND iri || '~~~~~~')
	AND sb.author = (SELECT id FROM public_keys WHERE principal = :author)
	ORDER BY sb.ts
`)

func (idx *Index) IterComments(ctx context.Context, resource IRI) (it iter.Seq2[cid.Cid, *Comment], check func() error) {
	var outErr error

	check = func() error { return outErr }
	it = func(yield func(cid.Cid, *Comment) bool) {
		conn, release, err := idx.db.Conn(ctx)
		if err != nil {
			outErr = err
			return
		}
		defer release()

		buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
		rows, check := sqlitex.Query(conn, qIterComments(), resource)
		for row := range rows {
			var (
				codec = row.ColumnInt64(0)
				hash  = row.ColumnBytesUnsafe(1)
				data  = row.ColumnBytesUnsafe(2)
			)

			buf, err = idx.bs.decoder.DecodeAll(data, buf)
			if err != nil {
				outErr = err
				break
			}

			chcid := cid.NewCidV1(uint64(codec), hash)
			cmt := &Comment{}
			if err := cbornode.DecodeInto(buf, cmt); err != nil {
				outErr = fmt.Errorf("WalkChanges: failed to decode change %s for entity %s: %w", chcid, resource, err)
				break
			}

			if !yield(chcid, cmt) {
				break
			}

			buf = buf[:0] // reset the slice reusing the backing array
		}

		outErr = errors.Join(outErr, check())
	}

	return it, check
}

var qIterComments = dqb.Str(`
	SELECT
		b.codec,
		b.multihash,
		b.data
	FROM structural_blobs sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.type = 'Comment'
	AND sb.resource = (SELECT id FROM resources WHERE iri = :iri)
	ORDER BY sb.ts
`)

type blobType string

type Encoded[T any] struct {
	CID     cid.Cid
	Data    []byte
	Decoded T
}

func encodeBlob[T any](v T) (eb Encoded[T], err error) {
	data, err := cbornode.DumpObject(v)
	if err != nil {
		return eb, err
	}

	blk := ipfs.NewBlock(uint64(multicodec.DagCbor), data)

	return Encoded[T]{CID: blk.Cid(), Data: blk.RawData(), Decoded: v}, nil
}

// RawData implements blocks.Block interface.
func (eb Encoded[T]) RawData() []byte {
	return eb.Data
}

// Cid implements blocks.Block interface.
func (eb Encoded[T]) Cid() cid.Cid {
	return eb.CID
}

// String implements blocks.Block interface.
func (eb Encoded[T]) String() string {
	return fmt.Sprintf("[EncodedBlob %s]", eb.CID)
}

// Loggable implements blocks.Block interface.
func (eb Encoded[T]) Loggable() map[string]interface{} {
	return map[string]interface{}{
		"cid": eb.CID,
	}
}

type indexingCtx struct {
	conn       *sqlite.Conn
	blockStore *blockStore
	log        *zap.Logger

	blobID int64

	mustTrackUnreads bool

	// Lookup tables for internal database IDs.
	pubKeys   map[string]int64
	resources map[IRI]int64
	blobs     map[cid.Cid]blobsGetSizeResult

	lookup *LookupCache
}

func newCtx(conn *sqlite.Conn, id int64, bs *blockStore, log *zap.Logger) *indexingCtx {
	return &indexingCtx{
		conn:       conn,
		blockStore: bs,
		log:        log,

		blobID: id,

		// Setting arbitrary size for maps, to avoid dynamic resizing in most cases.
		pubKeys:   make(map[string]int64, 16),
		resources: make(map[IRI]int64, 16),
		blobs:     make(map[cid.Cid]blobsGetSizeResult, 16),

		lookup: NewLookupCache(conn),
	}
}

type stashReason string

const (
	stashReasonFailedPrecondition stashReason = "FailedPrecondition"
	stashReasonPermissionDenied   stashReason = "PermissionDenied"
	stashReasonBadData            stashReason = "BadData"
)

type stashMetadata struct {
	MissingBlobs  []cid.Cid        `json:"missingBlobs,omitempty"`
	DeniedSigners []core.Principal `json:"deniedSigners,omitempty"`
	Details       string           `json:"details,omitempty"`
}

type stashError struct {
	Reason   stashReason
	Metadata stashMetadata
}

func (se stashError) As(v any) bool {
	tt, ok := v.(*stashError)
	if !ok {
		return false
	}

	*tt = se
	return true
}

func (se stashError) Error() string {
	return fmt.Sprintf("stash error: %s", se.Reason)
}

func (idx *indexingCtx) Unstash() error {
	return sqlitex.Exec(idx.conn, "DELETE FROM stashed_blobs WHERE id = ?", nil, idx.blobID)
}

func (idx *indexingCtx) Stash(reason stashReason, metadata any) error {
	extraJSON := "{}"
	if metadata != nil {
		data, err := json.Marshal(metadata)
		if err != nil {
			return err
		}
		extraJSON = strbytes.String(data)
	}

	return sqlitex.Exec(idx.conn, qStashBlob(), nil, idx.blobID, reason, extraJSON)
}

var qStashBlob = dqb.Str(`
	INSERT INTO stashed_blobs (id, reason, extra_attrs) VALUES (?, ?, ?);
`)

func (idx *indexingCtx) SaveBlob(b structuralBlob) error {
	var (
		blobAuthor   maybe.Value[int64]
		blobResource maybe.Value[int64]
		blobTime     maybe.Value[int64]
		blobMeta     maybe.Value[[]byte]
		blobGenesis  maybe.Value[int64]
	)

	if b.Author != nil {
		_, kid, err := idx.ensureAccount(b.Author)
		if err != nil {
			return err
		}
		blobAuthor = maybe.New(kid)
	}

	if b.GenesisBlob.Defined() {
		id, err := idx.ensureBlob(b.GenesisBlob)
		if err != nil {
			return err
		}
		blobGenesis = maybe.New(id)
	}

	if b.Resource.ID != "" {
		rid, err := idx.ensureResource(b.Resource.ID)
		if err != nil {
			return err
		}
		blobResource = maybe.New(rid)

		if b.Resource.GenesisBlob.Defined() {
			if _, err := idx.ensureBlob(b.Resource.GenesisBlob); err != nil {
				return err
			}
		}

		if err := idx.ensureResourceMetadata(b.Resource.ID, b.Resource.GenesisBlob, b.Resource.Owner, b.Resource.CreateTime); err != nil {
			return err
		}
	}

	if b.ExtraAttrs != nil {
		data, err := json.Marshal(b.ExtraAttrs)
		if err != nil {
			return err
		}

		blobMeta = maybe.New(data)
	}

	if !b.Ts.IsZero() {
		// For changes we need microsecond timestamp, so we use it for all the blobs.
		blobTime = maybe.New(b.Ts.UnixMilli())
	}

	if err := dbStructuralBlobsInsert(idx.conn, idx.blobID, b.Type, blobAuthor, blobGenesis, blobResource, blobTime, blobMeta); err != nil {
		return err
	}

	for _, link := range b.BlobLinks {
		tgt, err := idx.ensureBlob(link.Target)
		if err != nil {
			return fmt.Errorf("failed to ensure link target blob %s: %w", link.Target, err)
		}
		if err := dbBlobLinksInsertOrIgnore(idx.conn, idx.blobID, link.Type, tgt); err != nil {
			return fmt.Errorf("failed to insert blob link: %w", err)
		}
	}

	for _, link := range b.ResourceLinks {
		tgt, err := idx.ensureResource(link.Target)
		if err != nil {
			return fmt.Errorf("failed to ensure resource %s: %w", link.Target, err)
		}

		meta, err := json.Marshal(link.Meta)
		if err != nil {
			return fmt.Errorf("failed to encode resource link metadata as json: %w", err)
		}

		if err := dbResourceLinksInsert(idx.conn, idx.blobID, tgt, link.Type, link.IsPinned, meta); err != nil {
			return fmt.Errorf("failed to insert resource link: %w", err)
		}
	}

	return nil
}

func (idx *indexingCtx) AssertBlobData(c cid.Cid) (err error) {
	delid, err := dbBlobsGetSize(idx.conn, c.Hash())
	if err != nil {
		return err
	}
	if delid.BlobsID == 0 {
		return fmt.Errorf("blob %q not found", c)
	}

	if delid.BlobsSize < 0 {
		return fmt.Errorf("blob %q is known, but has no data", c)
	}

	return nil
}

func (idx *indexingCtx) ensureAccount(key core.Principal) (aid, kid int64, err error) {
	kid, err = idx.ensurePubKey(key)
	if err != nil {
		return 0, 0, err
	}

	accountResource := IRI("hm://" + key.String())

	aid, err = idx.ensureResource(accountResource)
	if err != nil {
		return 0, 0, err
	}

	if err := idx.ensureResourceMetadata(accountResource, cid.Undef, key, time.Time{}); err != nil {
		return 0, 0, err
	}

	return aid, kid, nil
}

func (idx *indexingCtx) ensurePubKey(key core.Principal) (int64, error) {
	if id, ok := idx.pubKeys[key.UnsafeString()]; ok {
		return id, nil
	}

	res, err := DbPublicKeysLookupID(idx.conn, key)
	if err != nil {
		return 0, err
	}

	var id int64
	if res > 0 {
		id = res
	} else {
		ins, err := DbPublicKeysInsert(idx.conn, key)
		if err != nil {
			return 0, err
		}

		if ins <= 0 {
			panic("BUG: failed to insert key for some reason")
		}

		id = ins
	}

	idx.pubKeys[key.UnsafeString()] = id
	return id, nil
}

func (idx *indexingCtx) ensureBlob(c cid.Cid) (int64, error) {
	if size, ok := idx.blobs[c]; ok {
		return size.BlobsID, nil
	}

	codec, hash := ipfs.DecodeCID(c)

	size, err := dbBlobsGetSize(idx.conn, hash)
	if err != nil {
		return 0, err
	}

	if size.BlobsID == 0 {
		ins, err := dbBlobsInsert(idx.conn, 0, hash, int64(codec), nil, -1)
		if err != nil {
			return 0, err
		}
		if ins == 0 {
			return 0, fmt.Errorf("failed to ensure blob %s after insert", c)
		}
		size.BlobsID = ins
		size.BlobsSize = -1
	}

	idx.blobs[c] = size
	return size.BlobsID, nil
}

func (idx *indexingCtx) ensureResource(r IRI) (int64, error) {
	if id, ok := idx.resources[r]; ok {
		return id, nil
	}

	res, err := dbResourcesLookupID(idx.conn, string(r))
	if err != nil {
		return 0, err
	}

	var id int64
	if res.ResourcesID > 0 {
		id = res.ResourcesID
	} else {
		ins, err := dbEntitiesInsertOrIgnore(idx.conn, string(r))
		if err != nil {
			return 0, err
		}

		if ins <= 0 {
			panic("BUG: failed to insert resource for some reason")
		}

		id = ins
	}

	idx.resources[r] = id
	return id, nil
}

func (idx *indexingCtx) ensureResourceMetadata(r IRI, genesis cid.Cid, owner core.Principal, createTime time.Time) error {
	id, err := idx.ensureResource(r)
	if err != nil {
		return err
	}

	if owner != nil {
		oid, err := idx.ensurePubKey(owner)
		if err != nil {
			return err
		}

		if _, err := dbResourcesMaybeSetOwner(idx.conn, id, oid); err != nil {
			return err
		}
	}

	if genesis.Defined() {
		gid, err := idx.ensureBlob(genesis)
		if err != nil {
			return err
		}

		if _, err := dbResourcesMaybeSetGenesis(idx.conn, id, gid); err != nil {
			return err
		}
	}

	if !createTime.IsZero() {
		// We don't need microsecond precision for create time in resources. It's mostly here for convenience anyway.
		if _, err := dbResourcesMaybeSetTimestamp(idx.conn, id, createTime.Unix()); err != nil {
			return err
		}
	}

	return nil
}

func indexURL(sb *structuralBlob, log *zap.Logger, anchor, linkType, rawURL string) error {
	if rawURL == "" {
		return nil
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		log.Warn("FailedToParseURL",
			zap.String("url", rawURL),
			zap.Error(err),
			// Hex hash is useful to lookup in the database.
			zap.String("blobHashHex", sb.CID.Hash().HexString()),
			// CID is useful to lookup in the debug browser at /debug/cid/<cid>.
			zap.String("blobCID", sb.CID.String()),
		)
		return nil
	}

	switch {
	case u.Scheme == "hm" && u.Host != "c":
		uq := u.Query()

		linkMeta := DocLinkMeta{
			Anchor:         anchor,
			TargetFragment: u.Fragment,
			TargetVersion:  uq.Get("v"),
		}

		target := IRI("hm://" + u.Host + u.Path)

		isLatest := uq.Has("l") || linkMeta.TargetVersion == ""

		sb.AddResourceLink(linkType, target, !isLatest, linkMeta)

		vblobs, err := Version(linkMeta.TargetVersion).Parse()
		if err != nil {
			return err
		}

		for _, vcid := range vblobs {
			sb.AddBlobLink(linkType, vcid)
		}
	case u.Scheme == "hm" && u.Host == "c":
		c, err := cid.Decode(strings.TrimPrefix(u.Path, "/"))
		if err != nil {
			return fmt.Errorf("failed to parse comment CID %s: %w", rawURL, err)
		}

		sb.AddBlobLink(linkType, c)
	case u.Scheme == "ipfs":
		c, err := cid.Decode(u.Hostname())
		if err != nil {
			return fmt.Errorf("failed to parse IPFS URL %s: %w", rawURL, err)
		}

		sb.AddBlobLink(linkType, c)
	}

	return nil
}

// DocLinkMeta is a metadata for a document link.
type DocLinkMeta struct {
	Anchor         string `json:"a,omitempty"`
	TargetFragment string `json:"f,omitempty"`
	TargetVersion  string `json:"v,omitempty"`
}

func isIndexable[T multicodec.Code | cid.Cid](v T) bool {
	var code multicodec.Code

	switch v := any(v).(type) {
	case multicodec.Code:
		code = v
	case cid.Cid:
		code = multicodec.Code(v.Prefix().Codec)
	}

	return code == multicodec.DagCbor || code == multicodec.DagPb
}

// Query allows to execute raw SQLite queries.
func (idx *Index) Query(ctx context.Context, fn func(conn *sqlite.Conn) error) (err error) {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	// TODO(burdiyan): make the main database read-only.
	// This is commented because we want to allow writing into an attached in-memory database
	// while keeping the main database read-only. Apparently this is not possible in SQLite.
	// There're a bunch of other ways to achieve this but there's currently no time for implementing them.
	//
	// if err := sqlitex.ExecTransient(conn, "PRAGMA query_only = on;", nil); err != nil {
	// 	return err
	// }
	// defer func() {
	// 	err = multierr.Combine(err, sqlitex.ExecTransient(conn, "PRAGMA query_only = off;", nil))
	// }()

	return fn(conn)
}

// LookupCache is used to lookup various table records,
// caching the results in memory to avoid repeated database queries.
// It's only valid for the lifetime of the current transaction.
// Not safe for concurrent use.
type LookupCache struct {
	conn *sqlite.Conn

	publicKeys     map[int64]core.Principal
	cids           map[int64]cid.Cid
	documentTitles map[IRI]string
}

// NewLookupCache creates a new [LookupCache].
func NewLookupCache(conn *sqlite.Conn) *LookupCache {
	return &LookupCache{
		conn:           conn,
		publicKeys:     make(map[int64]core.Principal),
		cids:           make(map[int64]cid.Cid),
		documentTitles: make(map[IRI]string),
	}
}

// CID looks up a CID of a blob.
func (l *LookupCache) CID(id int64) (c cid.Cid, err error) {
	if сc, ok := l.cids[id]; ok {
		return сc, nil
	}

	rows, check := sqlitex.Query(l.conn, qLookupCID(), id)
	for row := range rows {
		codec := row.ColumnInt64(0)
		hash := row.ColumnBytesUnsafe(1)

		c = cid.NewCidV1(uint64(codec), hash)
		l.cids[id] = c
		break
	}

	err = errors.Join(err, check())
	if err != nil {
		return cid.Undef, err
	}

	if !c.Defined() {
		return cid.Undef, fmt.Errorf("not found CID with id %d", id)
	}

	return c, nil
}

var qLookupCID = dqb.Str(`
	SELECT codec, multihash
	FROM blobs INDEXED BY blobs_metadata
	WHERE id = :id;
`)

// DocumentTitle looks up title of the document as per indexed attributes.
func (l *LookupCache) DocumentTitle(iri IRI) (title string, ok bool, err error) {
	if title, ok := l.documentTitles[iri]; ok {
		return title, true, nil
	}

	rows, check := sqlitex.Query(l.conn, qLookupDocumentTitle(), iri)
	for row := range rows {
		title = row.ColumnText(0)
		ok = true
		break
	}
	err = errors.Join(err, check())

	if ok {
		l.documentTitles[iri] = title
	}

	return title, ok, err
}

var qLookupDocumentTitle = dqb.Str(`
	SELECT COALESCE(metadata->>'$.name.v', metadata->>'$.title.v')
	FROM document_generations
	WHERE resource = (SELECT id FROM resources WHERE iri = :iri)
	GROUP BY resource HAVING generation = MAX(generation)
`)

// PublicKey returns the public key by the internal database ID.
func (l *LookupCache) PublicKey(id int64) (out core.Principal, err error) {
	if key, ok := l.publicKeys[id]; ok {
		return key, nil
	}

	rows, check := sqlitex.Query(l.conn, qLookupPublicKey(), id)
	for row := range rows {
		out = core.Principal(row.ColumnBytes(0))
		break
	}

	err = errors.Join(err, check())
	if err != nil {
		return nil, err
	}

	if len(out) == 0 {
		return nil, fmt.Errorf("principal %d not found", id)
	}

	l.publicKeys[id] = out

	return out, nil
}

var qLookupPublicKey = dqb.Str(`
	SELECT principal
	FROM public_keys
	WHERE id = :id;
`)

func reindexStashedBlobs(trackUnreads bool, conn *sqlite.Conn, reason stashReason, match string, bs *blockStore, log *zap.Logger) (err error) {
	rows, check := sqlitex.Query(conn, qLoadStashedBlobs(), reason, match)
	defer func() {
		err = errors.Join(err, check())
	}()

	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		var (
			id      = row.ColumnInt64(inc())
			codec   = row.ColumnInt64(inc())
			hash    = row.ColumnBytesUnsafe(inc())
			rawData = row.ColumnBytesUnsafe(inc())
			size    = row.ColumnInt64(inc())
		)

		data, err := bs.decompress(rawData, int(size))
		if err != nil {
			return err
		}

		c := cid.NewCidV1(uint64(codec), hash)

		if err := indexBlob(trackUnreads, conn, id, c, data, bs, log); err != nil {
			return err
		}
	}

	return nil
}

var qLoadStashedBlobs = dqb.Str(`
	SELECT
		blobs.id,
		blobs.codec,
		blobs.multihash,
		blobs.data,
		blobs.size
	FROM blobs WHERE id IN (
		SELECT id FROM stashed_blobs
		WHERE reason = :reason
		AND instr(extra_attrs, json_quote(:signer)) > 0
	)
`)
