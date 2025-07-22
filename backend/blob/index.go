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
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/ipfs"
	"seed/backend/util/btree"
	"seed/backend/util/dqb"
	"seed/backend/util/maybe"
	"seed/backend/util/must"
	"seed/backend/util/strbytes"
	"slices"
	"strings"
	"sync"
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

// String implements fmt.Stringer.
func (iri IRI) String() string {
	return string(iri)
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

	mu sync.Mutex // protects from concurrent reindexing
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

// IPFSBlockstore returns the blockstore used by the index.
func (idx *Index) IPFSBlockstore() blockstore.Blockstore {
	return idx.bs
}

func indexBlob(trackUnreads bool, conn *sqlite.Conn, id int64, c cid.Cid, data []byte, bs *blockStore, log *zap.Logger) (err error) {
	release := sqlitex.Save(conn)
	defer func() {
		// This is really obscure and hard to reason about, because we want the handle stash error,
		// to actually stash the blob, but we don't want to bubble up the stash error upstream.
		// And the sqlitex.Save relies on the error to know whether to rollback or to release the savepoint.
		// So we temporarily keep the error, and then check whether release had any other errors,
		// and if not, we don't bubble up the error.

		var serr stashError
		if errors.As(err, &serr) {
			// We handle the stash error here. We rollback the savepoint,
			// but then we still need to use the same database transaction.
			release(&err)

			// We want to check if release added any other errors,
			// so if the resulting error is not of the stash error type, we know something happened during release,
			// so we can't proceed further.
			_, ok := err.(stashError)
			if !ok {
				return
			}

			// Released happend successfully, so we can reset the original stash error,
			// because we've already extracted the necessary metadata from it.
			err = nil

			// Declaring data here to avoid shadowing the err variable.
			var data []byte
			data, err = json.Marshal(serr.Metadata)
			if err != nil {
				return
			}
			extraJSON := strbytes.String(data)

			err = sqlitex.Exec(conn, qStashBlob(), nil, id, serr.Reason, extraJSON)
			return
		}

		// If error is not a stash error, we simply release the savepoint normally.
		release(&err)
	}()

	ictx := newCtx(conn, id, bs, log)
	ictx.mustTrackUnreads = trackUnreads
	if err := ictx.Unstash(); err != nil {
		return err
	}

	ok, err := ictx.IsBlobIndexed(c)
	if err != nil {
		return err
	}

	// If blob is already indexed, return early.
	if ok {
		return nil
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

		if maxRef.IsTombstone && maxRef.RedirectTarget == "" {
			outErr = status.Errorf(codes.FailedPrecondition, "document '%s' is marked as deleted", resource)
			return
		}

		if maxRef.RedirectTarget != "" {
			space, path, err := maxRef.RedirectTarget.SpacePath()
			if err != nil {
				outErr = err
				return
			}
			republish := !maxRef.IsTombstone // If it's a tombstone it's not a republish.
			outErr = must.Do2(status.Newf(codes.FailedPrecondition, "document '%s' has a redirect to %s (republish = %v)", resource, maxRef.RedirectTarget, republish).
				WithDetails(&documents.RedirectErrorDetails{
					TargetAccount: space.String(),
					TargetPath:    path,
					Republish:     republish,
				})).Err()
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

// IsValidAgent checks whether a key is allowed to act as an agent for a given space.
// For convenience this function returns true if both principals are the same.
func (idx *Index) IsValidAgent(ctx context.Context, space, agent core.Principal) (valid bool, err error) {
	if space.Equal(agent) {
		return true, nil
	}

	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return false, err
	}
	defer release()

	defer sqlitex.Save(conn)(&err)

	spaceID, err := DbPublicKeysLookupID(conn, space)
	if err != nil {
		return false, err
	}

	agentID, err := DbPublicKeysLookupID(conn, agent)
	if err != nil {
		return false, err
	}

	valid, err = isValidAgentKey(conn, spaceID, agentID)
	return valid, err
}

// IsValidWriter checks whether a key is allowed to write into a given space and path.
func (idx *Index) IsValidWriter(ctx context.Context, space core.Principal, path string, writer core.Principal) (valid bool, err error) {
	if space.Equal(writer) {
		return true, nil
	}

	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return false, err
	}
	defer release()

	defer sqlitex.Save(conn)(&err)

	writerID, err := DbPublicKeysLookupID(conn, writer)
	if err != nil {
		return false, err
	}

	iri, err := NewIRI(space, path)
	if err != nil {
		return false, err
	}

	valid, err = isValidWriter(conn, writerID, iri)
	return valid, err
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

		{
			isTomb := row.ColumnInt64(seq())
			if isTomb != 0 && isTomb != 1 {
				err = fmt.Errorf("BUG: invalid tombstone value %v", isTomb)
				break
			}

			g.IsTombstone = isTomb == 1
		}

		{
			g.RedirectTarget = IRI(row.ColumnText(seq()))
		}

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

func isValidWriter(conn *sqlite.Conn, writerID int64, resource IRI) (valid bool, err error) {
	parentsJSON := strbytes.String(
		must.Do2(
			json.Marshal(resource.Breadcrumbs()),
		),
	)

	owner, _, err := resource.SpacePath()
	if err != nil {
		return false, err
	}

	ownerID, err := DbPublicKeysLookupID(conn, owner)
	if err != nil {
		return false, err
	}

	if ownerID == writerID {
		return true, nil
	}

	rows, check := sqlitex.Query(conn, qIsValidWriter(), ownerID, writerID, parentsJSON)
	for range rows {
		valid = true
		break
	}

	err = errors.Join(err, check())
	return valid, err
}

var qIsValidWriter = dqb.Str(`
	-- owner, writer, breadcrumbs
	SELECT 1 AS valid
	FROM structural_blobs
	WHERE type = 'Capability'
	AND author = ?1
    AND extra_attrs->>'del' = ?2
    AND extra_attrs->>'role' IN ('WRITER', 'AGENT')
    AND resource IN (
    	SELECT r.id
     	FROM resources r
      	JOIN json_each(?3) each ON each.value = r.iri
    )
`)

func isValidAgentKey(conn *sqlite.Conn, parentID int64, delegateID int64) (valid bool, err error) {
	rows, check := sqlitex.Query(conn, qIsValidAgentKey(), parentID, delegateID)
	for range rows {
		valid = true
		break
	}

	err = errors.Join(err, check())
	return valid, err
}

var qIsValidAgentKey = dqb.Str(`
	SELECT 1
	FROM structural_blobs
	WHERE type = 'Capability'
	AND author = :issuer
	AND extra_attrs->>'del' = :delegate
	AND extra_attrs->>'role' = 'AGENT'
	LIMIT 1
`)

type generation struct {
	RefID          int64
	Generation     int64
	GenesisID      int64
	AuthorID       int64
	Ts             int64
	IsTombstone    bool
	RedirectTarget IRI
	Heads          []int64
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
	refs (id, generation, genesis, author, ts, is_tombstone, redirect_target, heads) AS (
		SELECT
			structural_blobs.id,
			COALESCE(extra_attrs->>'generation', 0) AS generation,
			genesis_blob,
			author,
			ts,
			COALESCE(extra_attrs->>'tombstone', 0) AS is_tombstone,
			COALESCE(extra_attrs->>'redirect', '') AS redirect_target,
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

// WalkCapabilities walks through capabilities for a specific resource.
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

// WalkCapabilitiesForDelegate walks through capabilities for a specific delegate.
func (idx *Index) WalkCapabilitiesForDelegate(ctx context.Context, delegate core.Principal, fn func(cid.Cid, *Capability) error) error {
	conn, release, err := idx.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
	if err := sqlitex.Exec(conn, qWalkCapabilitiesForDelegate(), func(stmt *sqlite.Stmt) error {
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
			return err
		}

		if err := fn(chcid, cpb); err != nil {
			return err
		}

		buf = buf[:0] // reset the slice reusing the backing array

		return nil
	}, delegate); err != nil {
		return err
	}

	return nil
}

var qWalkCapabilitiesForDelegate = dqb.Str(`
	SELECT
		b.codec,
		b.multihash,
		b.data
	FROM structural_blobs sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.type = 'Capability'
	AND sb.extra_attrs->>'del' = (SELECT id FROM public_keys WHERE principal = :delegate)
	ORDER BY sb.ts
`)

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

func (se stashError) Error() string {
	return fmt.Sprintf("stash error: %s: %+v", se.Reason, se.Metadata)
}

func (idx *indexingCtx) Unstash() error {
	return sqlitex.Exec(idx.conn, "DELETE FROM stashed_blobs WHERE id = ?", nil, idx.blobID)
}

var qStashBlob = dqb.Str(`
	INSERT OR IGNORE INTO stashed_blobs (id, reason, extra_attrs) VALUES (?, ?, ?);
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
		blobTime = maybe.New(b.Ts.UnixMilli())
	}

	if err := dbStructuralBlobsInsert(idx.conn, idx.blobID, string(b.Type), blobAuthor, blobGenesis, blobResource, blobTime, blobMeta); err != nil {
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

// IsBlobIndexed returns the current state of the blob.
func (idx *indexingCtx) IsBlobIndexed(c cid.Cid) (indexed bool, err error) {
	codec, hash := ipfs.DecodeCID(c)
	rows, check := sqlitex.Query(idx.conn, qIsBlobIndexed(), codec, hash)
	defer func() {
		err = errors.Join(err, check())
	}()

	for range rows {
		indexed = true
		break
	}

	return indexed, err
}

var qIsBlobIndexed = dqb.Str(`
	SELECT sb.id
	FROM structural_blobs sb
	JOIN blobs b INDEXED BY blobs_metadata_by_hash ON b.id = sb.id
	WHERE (b.codec, b.multihash) = (:codec, :multihash)
`)

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

// LookupCache is used to lookup various table records,
// caching the results in memory to avoid repeated database queries.
// It's only valid for the lifetime of the current transaction.
// Not safe for concurrent use.
type LookupCache struct {
	conn *sqlite.Conn

	publicKeys     map[int64]core.Principal
	cids           map[int64]cid.Cid
	documentTitles map[IRI]string
	recordIDs      map[cid.Cid]RecordID
}

// RecordID is the fully-qualified ID of a replaceable object.
type RecordID struct {
	Authority core.Principal
	TSID      TSID
}

// DecodeRecordID parses the record ID from string.
func DecodeRecordID(s string) (RecordID, error) {
	parts := strings.Split(s, "/")
	if len(parts) != 2 {
		return RecordID{}, fmt.Errorf("invalid record id '%v'", s)
	}

	authority, err := core.DecodePrincipal(parts[0])
	if err != nil {
		return RecordID{}, fmt.Errorf("invalid authority in record id '%v': %w", s, err)
	}

	tsid := TSID((parts[1]))

	if _, _, err := tsid.Parse(); err != nil {
		return RecordID{}, fmt.Errorf("invalid TSID in record id '%v': %w", s, err)
	}

	return RecordID{Authority: authority, TSID: tsid}, nil
}

// IRI converts the RecordID into an IRI.
func (rid RecordID) IRI() IRI {
	return IRI("hm://" + rid.String())
}

// String returns a string representation of the RecordID.
func (rid RecordID) String() string {
	return rid.Authority.String() + "/" + rid.TSID.String()
}

// NewLookupCache creates a new [LookupCache].
func NewLookupCache(conn *sqlite.Conn) *LookupCache {
	return &LookupCache{
		conn:           conn,
		publicKeys:     make(map[int64]core.Principal),
		cids:           make(map[int64]cid.Cid),
		documentTitles: make(map[IRI]string),
		recordIDs:      make(map[cid.Cid]RecordID),
	}
}

// Conn returns the underlying database connection of the LookupCache.
func (l *LookupCache) Conn() *sqlite.Conn {
	return l.conn
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

// RecordID looks up the RecordID for a given CID.
func (l *LookupCache) RecordID(c cid.Cid) (rid RecordID, err error) {
	if recID, ok := l.recordIDs[c]; ok {
		return recID, nil
	}

	rows, check := sqlitex.Query(l.conn, qLookupRecordID(), c.Prefix().Codec, c.Hash())
	for row := range rows {
		principal := core.Principal(row.ColumnBytes(0))
		tsid := TSID(row.ColumnText(1))

		rid = RecordID{
			Authority: principal,
			TSID:      tsid,
		}
		l.recordIDs[c] = rid
		break
	}

	err = errors.Join(err, check())
	if err != nil {
		return RecordID{}, err
	}

	if len(rid.Authority) == 0 || rid.TSID == "" {
		return RecordID{}, fmt.Errorf("record ID for CID %s not found", c)
	}

	return rid, nil
}

var qLookupRecordID = dqb.Str(`
	SELECT
		pk.principal,
		sb.extra_attrs->>'tsid' AS tsid
	FROM structural_blobs sb
	JOIN blobs b INDEXED BY blobs_metadata_by_hash
		ON b.id = sb.id
		AND (b.codec, b.multihash) = (:codec, :multihash)
	JOIN public_keys pk ON pk.id = sb.author
	LIMIT 1
`)

func reindexStashedBlobs(trackUnreads bool, conn *sqlite.Conn, reason stashReason, match string, bs *blockStore, log *zap.Logger) (err error) {
	rows, check := sqlitex.Query(conn, qLoadStashedBlobs(), reason, match)

	// We collect the stashed blobs into closures, to avoid nested SQLite queries,
	// because the result set here would select and update the same table, which sometimes gives unexpected results.
	var funcs []func() error
	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		var (
			id      = row.ColumnInt64(inc())
			codec   = row.ColumnInt64(inc())
			hash    = row.ColumnBytesUnsafe(inc())
			rawData = row.ColumnBytesUnsafe(inc())
			size    = row.ColumnInt64(inc())
		)

		data, xerr := bs.decompress(rawData, int(size))
		if xerr != nil {
			err = xerr
			break
		}

		c := cid.NewCidV1(uint64(codec), hash)

		funcs = append(funcs, func() error {
			return indexBlob(trackUnreads, conn, id, c, data, bs, log)
		})
	}

	err = errors.Join(err, check())
	if err != nil {
		return err
	}

	for _, fn := range funcs {
		if err := fn(); err != nil {
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
		AND instr(extra_attrs, :match) > 0
	)
`)
