package index

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/dqb"
	"seed/backend/util/maybe"
	"strconv"
	"strings"
	"time"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	blockstore "github.com/ipfs/boxo/blockstore"
	"github.com/ipfs/boxo/provider"
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

type Index struct {
	bs       *blockStore
	db       *sqlitex.Pool
	log      *zap.Logger
	provider provider.Provider
}

func NewIndex(db *sqlitex.Pool, log *zap.Logger, prov provider.Provider) *Index {
	return &Index{
		bs:       newBlockstore(db),
		db:       db,
		log:      log,
		provider: prov,
	}
}

func (idx *Index) SetProvider(prov provider.Provider) {
	// TODO(hm24): Providing doesn't really belong here,
	// we should extract it into a separate component/subsystem.
	// Indexing has no business caring about providing.

	if prov != nil {
		idx.provider = prov
	}
}

func (idx *Index) IPFSBlockstore() blockstore.Blockstore {
	return idx.bs
}

// indexBlob is an uber-function that knows about all types of blobs we want to index.
// This is probably a bad idea to put here, but for now it's easier to work with that way.
// TODO(burdiyan): eventually we might want to make this package agnostic to blob types.
func (idx *Index) indexBlob(conn *sqlite.Conn, id int64, c cid.Cid, data []byte) error {
	ictx := newCtx(conn, idx.provider, idx.log)

	for _, fn := range indexersList {
		if err := fn(ictx, id, c, data); err != nil {
			return err
		}
	}

	return nil
}

// CanEditResource checks whether author can edit the resource.
func (idx *Index) CanEditResource(ctx context.Context, resource IRI, author core.Principal) (ok bool, err error) {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return ok, err
	}
	defer release()

	res, err := dbEntitiesLookupID(conn, string(resource))
	if err != nil {
		return ok, err
	}
	if res.ResourcesID == 0 {
		return ok, status.Errorf(codes.NotFound, "resource %s not found", resource)
	}

	dbAuthor, err := dbPublicKeysLookupID(conn, author)
	if err != nil {
		return ok, err
	}
	if dbAuthor == 0 {
		return ok, status.Errorf(codes.NotFound, "author %s not found", author)
	}

	return res.ResourcesOwner == dbAuthor, nil
}

func (idx *Index) WalkChanges(ctx context.Context, resource IRI, author core.Principal, fn func(cid.Cid, *Change) error) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
	if err := sqlitex.Exec(conn, qWalkChanges(), func(stmt *sqlite.Stmt) error {
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
		ch := &Change{}
		if err := cbornode.DecodeInto(buf, ch); err != nil {
			return fmt.Errorf("WalkChanges: failed to decode change %s for entity %s: %w", chcid, resource, err)
		}

		if err := fn(chcid, ch); err != nil {
			return err
		}

		buf = buf[:0] // reset the slice reusing the backing array

		return nil
	}, resource, author, author, resource); err != nil {
		return err
	}

	return nil
}

var qWalkChanges = dqb.Str(`
	WITH RECURSIVE
	refs (id) AS (
		SELECT id
		FROM structural_blobs
		WHERE type = 'Ref'
		-- resource
		AND resource = (SELECT id FROM resources WHERE iri = ?)
		-- author
		AND (author = (SELECT id FROM public_keys WHERE principal = ?) OR author IN (
			SELECT DISTINCT extra_attrs->>'del'
			FROM structural_blobs
			WHERE type = 'Capability'
			-- author
			AND author = (SELECT id FROM public_keys WHERE principal = ?)
			-- iri
			AND resource IN (SELECT id FROM resources WHERE ? BETWEEN iri AND iri || '~~~~~~')
		))
	),
	changes (id) AS (
		SELECT bl.target
		FROM blob_links bl
		JOIN refs r ON r.id = bl.source AND bl.type = 'ref/head'

		UNION

		SELECT bl.target
		FROM blob_links bl
		JOIN changes c ON c.id = bl.source
		WHERE bl.type = 'change/dep'
	)
	SELECT
		codec,
		multihash,
		data
	FROM blobs b
	JOIN structural_blobs sb ON sb.id = b.id
	JOIN changes c ON c.id = b.id
	ORDER BY sb.ts
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

func (idx *Index) WalkComments(ctx context.Context, resource IRI, fn func(cid.Cid, *Comment) error) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
	if err := sqlitex.Exec(conn, qWalkComments(), func(stmt *sqlite.Stmt) error {
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
		cmt := &Comment{}
		if err := cbornode.DecodeInto(buf, cmt); err != nil {
			return fmt.Errorf("WalkChanges: failed to decode change %s for entity %s: %w", chcid, resource, err)
		}

		if err := fn(chcid, cmt); err != nil {
			return err
		}

		buf = buf[:0] // reset the slice reusing the backing array

		return nil
	}, resource); err != nil {
		return err
	}

	return nil
}

var qWalkComments = dqb.Str(`
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

func (idx *Index) WalkChangesFromHeads(ctx context.Context, resource IRI, heads []cid.Cid, fn func(cid.Cid, *Change) error) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	headsIDs := make([]int64, 0, len(heads))
	for _, head := range heads {
		dbres, err := dbBlobsGetSize(conn, head.Hash())
		if err != nil {
			return err
		}
		if dbres.BlobsID == 0 || dbres.BlobsSize < 0 {
			return fmt.Errorf("missing head %s for resource %s", head, resource)
		}

		headsIDs = append(headsIDs, dbres.BlobsID)
	}

	headsJSON := headsToJSON(headsIDs)

	buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
	if err := sqlitex.Exec(conn, qWalkChangesFromHeads(), func(stmt *sqlite.Stmt) error {
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
		ch := &Change{}
		if err := cbornode.DecodeInto(buf, ch); err != nil {
			return fmt.Errorf("WalkChangesFromHeads: failed to decode change %s for entity %s: %w", chcid, resource, err)
		}

		if err := fn(chcid, ch); err != nil {
			return err
		}

		buf = buf[:0] // reset the slice reusing the backing array

		return nil
	}, headsJSON); err != nil {
		return err
	}

	return nil
}

var qWalkChangesFromHeads = dqb.Str(`
	WITH RECURSIVE
	changes (id) AS (
		SELECT value FROM json_each(:heads)

		UNION

		SELECT bl.target
		FROM blob_links bl
		JOIN changes c ON c.id = bl.source
		WHERE bl.type = 'change/dep'
	)
	SELECT
		codec,
		multihash,
		data
	FROM blobs b
	JOIN structural_blobs sb ON sb.id = b.id
	JOIN changes c ON c.id = b.id
	ORDER BY sb.ts
`)

func headsToJSON(heads []int64) string {
	var sb strings.Builder
	sb.WriteByte('[')
	for i, h := range heads {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(strconv.FormatInt(h, 10))
	}
	sb.WriteByte(']')
	return sb.String()
}

type blobType string

type EncodedBlob[T any] struct {
	CID     cid.Cid
	Data    []byte
	Decoded T
}

func encodeBlob[T any](v T) (eb EncodedBlob[T], err error) {
	data, err := cbornode.DumpObject(v)
	if err != nil {
		return eb, err
	}

	blk := ipfs.NewBlock(uint64(multicodec.DagCbor), data)

	return EncodedBlob[T]{CID: blk.Cid(), Data: blk.RawData(), Decoded: v}, nil
}

// RawData implements blocks.Block interface.
func (eb EncodedBlob[T]) RawData() []byte {
	return eb.Data
}

// Cid implements blocks.Block interface.
func (eb EncodedBlob[T]) Cid() cid.Cid {
	return eb.CID
}

// String implements blocks.Block interface.
func (eb EncodedBlob[T]) String() string {
	return fmt.Sprintf("[EncodedBlob %s]", eb.CID)
}

// Loggable implements blocks.Block interface.
func (eb EncodedBlob[T]) Loggable() map[string]interface{} {
	return map[string]interface{}{
		"cid": eb.CID,
	}
}

type indexingCtx struct {
	conn     *sqlite.Conn
	provider provider.Provider
	log      *zap.Logger

	// Lookup tables for internal database IDs.
	pubKeys   map[string]int64
	resources map[IRI]int64
	blobs     map[cid.Cid]int64
}

func newCtx(conn *sqlite.Conn, provider provider.Provider, log *zap.Logger) *indexingCtx {
	return &indexingCtx{
		conn:     conn,
		provider: provider,
		log:      log,
		// Setting arbitrary size for maps, to avoid dynamic resizing in most cases.
		pubKeys:   make(map[string]int64, 16),
		resources: make(map[IRI]int64, 16),
		blobs:     make(map[cid.Cid]int64, 16),
	}
}

func (idx *indexingCtx) SaveBlob(id int64, b StructuralBlob) error {
	var (
		blobAuthor   maybe.Value[int64]
		blobResource maybe.Value[int64]
		blobTime     maybe.Value[int64]
		blobMeta     maybe.Value[[]byte]
	)

	if b.Author != nil {
		_, kid, err := idx.ensureAccount(b.Author)
		if err != nil {
			return err
		}
		blobAuthor = maybe.New(kid)
	}

	if b.GenesisBlob.Defined() {
		if _, err := idx.ensureBlob(b.GenesisBlob); err != nil {
			return err
		}
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

	if b.Meta != nil {
		data, err := json.Marshal(b.Meta)
		if err != nil {
			return err
		}

		blobMeta = maybe.New(data)
	}

	if !b.Ts.IsZero() {
		// For changes we need microsecond timestamp, so we use it for all the blobs.
		blobTime = maybe.New(b.Ts.UnixMicro())
	}

	if err := dbStructuralBlobsInsert(idx.conn, id, b.Type, blobAuthor, blobResource, blobTime, blobMeta); err != nil {
		return err
	}

	for _, link := range b.BlobLinks {
		tgt, err := idx.ensureBlob(link.Target)
		if err != nil {
			return fmt.Errorf("failed to ensure link target blob %s: %w", link.Target, err)
		}
		if err := dbBlobLinksInsertOrIgnore(idx.conn, id, link.Type, tgt); err != nil {
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

		if err := dbResourceLinksInsert(idx.conn, id, tgt, link.Type, link.IsPinned, meta); err != nil {
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

	res, err := dbPublicKeysLookupID(idx.conn, key)
	if err != nil {
		return 0, err
	}

	var id int64
	if res > 0 {
		id = res
	} else {
		ins, err := dbPublicKeysInsert(idx.conn, key)
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
	if id, ok := idx.blobs[c]; ok {
		return id, nil
	}

	codec, hash := ipfs.DecodeCID(c)

	size, err := dbBlobsGetSize(idx.conn, hash)
	if err != nil {
		return 0, err
	}

	var id int64
	if size.BlobsID != 0 {
		id = size.BlobsID
	} else {
		ins, err := dbBlobsInsert(idx.conn, 0, hash, int64(codec), nil, -1)
		if err != nil {
			return 0, err
		}
		if ins == 0 {
			return 0, fmt.Errorf("failed to ensure blob %s after insert", c)
		}
		id = ins
	}

	idx.blobs[c] = id
	return id, nil
}

func (idx *indexingCtx) ensureResource(r IRI) (int64, error) {
	if id, ok := idx.resources[r]; ok {
		return id, nil
	}

	res, err := dbEntitiesLookupID(idx.conn, string(r))
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
		if idx.provider != nil {
			go func() {
				c, err := ipfs.NewCID(uint64(multicodec.Raw), uint64(multicodec.Identity), []byte(string(r)))
				if err != nil {
					idx.log.Warn("failed to convert entit into CID", zap.String("eid", string(r)), zap.Error(err))
				}
				if err = idx.provider.Provide(c); err != nil {
					idx.log.Warn("Failed to provide entity", zap.String("eid", string(r)), zap.Error(err))
				}
				idx.log.Debug("Providing resource", zap.String("eid", string(r)), zap.String("CID", c.String()))
				return
			}()
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

func indexURL(sb *StructuralBlob, log *zap.Logger, anchor, linkType, rawURL string) error {
	if rawURL == "" {
		return nil
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		log.Warn("FailedToParseURL", zap.String("url", rawURL), zap.Error(err))
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
