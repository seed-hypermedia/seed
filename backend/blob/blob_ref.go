package blob

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/maybe"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/unsafeutil"
	"slices"
	"strings"
	"time"

	"github.com/RoaringBitmap/roaring/v2/roaring64"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
)

// TypeRef is the type of the Ref blob.
const TypeRef Type = "Ref"

func init() {
	cbornode.RegisterCborType(Ref{})
	cbornode.RegisterCborType(RedirectTarget{})
}

// Ref is a blob that claims an entry for a path in a space
// to point to some other blobs, namely document changes.
// It's similar to a Git Ref, but is signed.
type Ref struct {
	BaseBlob

	Space_      core.Principal  `refmt:"space,omitempty"` // Use Space() method.
	Path        string          `refmt:"path,omitempty"`
	GenesisBlob cid.Cid         `refmt:"genesisBlob,omitempty"` // TODO(burdiyan): this should probably be deprecated and generation should be enough.
	Capability  cid.Cid         `refmt:"capability,omitempty"`
	Heads       []cid.Cid       `refmt:"heads"`
	Redirect    *RedirectTarget `refmt:"redirect,omitempty"`
	Generation  int64           `refmt:"generation,omitempty"`
	Visibility  Visibility      `refmt:"visibility,omitempty"`
}

// NewRef creates a new Ref blob.
func NewRef(kp *core.KeyPair, generation int64, genesis cid.Cid, space core.Principal, path string, heads []cid.Cid, ts time.Time, visibility Visibility) (eb Encoded[*Ref], err error) {
	ru := &Ref{
		BaseBlob: BaseBlob{
			Type:   TypeRef,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Path:        path,
		GenesisBlob: genesis,
		Heads:       heads,
		Generation:  generation,
		Visibility:  visibility,
	}

	if !kp.Principal().Equal(space) {
		ru.Space_ = space
	}

	if err := signBlob(kp, ru, &ru.BaseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(ru)
}

// NewRefRedirect creates a new Ref blob that redirects to another document.
func NewRefRedirect(kp *core.KeyPair, generation int64, genesis cid.Cid, space core.Principal, path string, rt RedirectTarget, ts time.Time) (eb Encoded[*Ref], err error) {
	// If we redirect within the same space, we don't need to specify the space in the redirect target.
	if space.Equal(rt.Space) {
		rt.Space = nil
	}

	ru := &Ref{
		BaseBlob: BaseBlob{
			Type:   TypeRef,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Path:        path,
		GenesisBlob: genesis,
		Redirect:    &rt,
		Generation:  generation,
	}

	if !kp.Principal().Equal(space) {
		ru.Space_ = space
	}

	if err := signBlob(kp, ru, &ru.BaseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(ru)
}

// Space returns the space the Ref is applied to.
func (r *Ref) Space() core.Principal {
	if len(r.Space_) == 0 {
		return r.Signer
	}

	return r.Space_
}

// RedirectIRI returns the IRI for the redirect target (if any).
func (r *Ref) RedirectIRI() (IRI, error) {
	if r.Redirect == nil {
		return "", fmt.Errorf("redirect target is not set")
	}

	targetSpace := r.Redirect.Space
	if targetSpace == nil {
		targetSpace = r.Space()
	}

	return NewIRI(targetSpace, r.Redirect.Path)
}

// IsTombstone indicates whether a Ref is a tombstone Ref.
func (r *Ref) IsTombstone() bool {
	// A ref is a tombstone if it points to no heads, and it's not a republish.
	// We don't treat republishes as tombstones,
	// because they are still valid documents and should appear in lists and search results.
	return len(r.Heads) == 0 && (r.Redirect == nil || !r.Redirect.Republish)
}

// RedirectTarget holds information about the redirect target.
type RedirectTarget struct {
	Space     core.Principal `refmt:"space,omitempty"`
	Path      string         `refmt:"path,omitempty"`
	Republish bool           `refmt:"republish,omitempty"`
}

func init() {
	matcher := makeCBORTypeMatch(TypeRef)

	registerIndexer(TypeRef,
		func(c cid.Cid, data []byte) (eb Encoded[*Ref], err error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return eb, errSkipIndexing
			}

			v := &Ref{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return eb, err
			}

			if err := verifyBlob(v.Signer, v, v.Sig); err != nil {
				return eb, err
			}

			eb.CID = c
			eb.Data = data
			eb.Decoded = v
			return eb, nil
		},
		indexRef,
	)
}

func indexRef(ictx *indexingCtx, _ int64, eb Encoded[*Ref]) error {
	c, v := eb.CID, eb.Decoded

	type Meta struct {
		Tombstone      bool       `json:"tombstone,omitempty"`
		Generation     int64      `json:"generation,omitempty"`
		RedirectTarget string     `json:"redirect,omitempty"`
		Republish      bool       `json:"republish,omitempty"`
		Visibility     Visibility `json:"visibility,omitempty"`
	}

	// We decided not to allow redirects or tombstones for home documents for now.
	if v.Path == "" && (v.Redirect != nil || len(v.Heads) == 0) {
		return fmt.Errorf("redirects or tombstones on home documents are not allowed")
	}

	space := v.Space()

	iri, err := NewIRI(space, v.Path)
	if err != nil {
		return err
	}

	var sb structuralBlob
	// Refs have explicit visibility field.
	if v.Ts.Equal(unixZero) {
		sb = newStructuralBlob(c, eb.Decoded.Type, v.Signer, v.Ts, iri, v.GenesisBlob, space, v.Ts, v.Visibility)
	} else {
		sb = newStructuralBlob(c, eb.Decoded.Type, v.Signer, v.Ts, iri, v.GenesisBlob, space, time.Time{}, v.Visibility)
	}

	if v.GenesisBlob.Defined() {
		sb.GenesisBlob = v.GenesisBlob
	}

	meta := Meta{
		Generation: v.Generation,
		Visibility: v.Visibility,
	}

	switch {
	// A normal Ref has to have Genesis and Heads.
	case v.GenesisBlob.Defined() && len(v.Heads) > 0:
	// A tombstone Ref must have Genesis and no Heads.
	case v.GenesisBlob.Defined() && len(v.Heads) == 0:
		meta.Tombstone = v.IsTombstone()
		if v.Redirect != nil {
			redirectTarget, err := v.RedirectIRI()
			if err != nil {
				return err
			}

			meta.RedirectTarget = string(redirectTarget)
			meta.Republish = v.Redirect.Republish
		}
	// All the other cases are invalid.
	default:
		return fmt.Errorf("invalid Ref blob invariants %+v", v)
	}

	if v.Visibility == VisibilityPrivate {
		if v.Path == "" {
			return fmt.Errorf("invalid Ref: private Ref must have a path")
		}

		if v.Path[0] != '/' || strings.Count(v.Path, "/") != 1 {
			return fmt.Errorf("invalid Ref: private Ref must have a single path segment with a single leading slash: got %s", v.Path)
		}
	}

	sb.ExtraAttrs = meta

	for _, head := range v.Heads {
		sb.AddBlobLink("ref/head", head)
	}

	if v.Capability.Defined() {
		sb.AddBlobLink("ref/capability", v.Capability)
	}

	if err := ictx.SaveBlob(sb); err != nil {
		return err
	}

	if err := crossLinkRefMaybe(ictx, v); err != nil {
		return err
	}

	return nil
}

func crossLinkRefMaybe(ictx *indexingCtx, v *Ref) error {
	if err := ictx.Unstash(); err != nil {
		return err
	}

	conn := ictx.conn

	memberID, err := DbPublicKeysLookupID(conn, v.Signer)
	if err != nil {
		return err
	}
	if memberID == 0 {
		panic("BUG: Ref signer is not indexed")
	}

	iri, err := NewIRI(v.Space(), v.Path)
	if err != nil {
		return err
	}

	// If we've got a Ref but this member is not valid yet/anymore, we don't want to populate our indexes.
	ok, err := isValidWriter(conn, memberID, iri)
	if err != nil {
		return err
	}
	if !ok {
		// If it's not a valid member, we don't fail.
		// We just stop the indexing, and we'll take care of it later when/if we find the Capability.
		return stashError{
			Reason: stashReasonPermissionDenied,
			Metadata: stashMetadata{
				DeniedSigners: []core.Principal{v.Signer},
			},
		}
	}

	resDB, err := dbResourcesLookupID(conn, string(iri))
	if err != nil {
		return err
	}

	resourceID := resDB.ResourcesID

	if resourceID == 0 {
		panic("BUG: resource ID is not indexed")
	}

	var dg documentGeneration
	if err := dg.load(conn, resourceID, v.Generation, v.GenesisBlob.String()); err != nil {
		return err
	}

	isTombstone := v.IsTombstone()
	refTime := v.Ts.UnixMilli()

	if !isTombstone {
		var queue []int64
		for _, h := range v.Heads {
			bsize, err := dbBlobsGetSize(conn, h.Hash(), false)
			if err != nil {
				return err
			}

			// If any of the heads is missing (i.e. wasn't indexed before),
			// we don't want to index this Ref.
			// I.e. this Ref won't be visible until all the heads are indexed first,
			// so we have to stop here and avoid saving the document generation data.
			if bsize.BlobsID == 0 || bsize.BlobsSize < 0 {
				return stashError{
					Reason: stashReasonFailedPrecondition,
					Metadata: stashMetadata{
						MissingBlobs: []cid.Cid{h},
					},
				}
			}

			queue = append(queue, bsize.BlobsID)
		}

		pendingChangesMap := make(map[int64]changeMetadata)

		for len(queue) > 0 {
			change := queue[0]
			queue = queue[1:]

			if dg.Changes.Contains(uint64(change)) {
				continue
			}

			if _, ok := pendingChangesMap[change]; ok {
				continue
			}

			var cm changeMetadata
			if err := cm.load(conn, change); err != nil {
				return err
			}

			if cm.ID == 0 {
				c, err := ictx.lookup.CID(change)
				if err != nil {
					return err
				}

				return stashError{
					Reason: stashReasonFailedPrecondition,
					Metadata: stashMetadata{
						MissingBlobs: []cid.Cid{c},
					},
				}
			}

			changeGenesis, err := ictx.lookup.CID(cm.Genesis())
			if err != nil {
				return err
			}

			if !v.GenesisBlob.Equals(changeGenesis) {
				c, err := ictx.lookup.CID(change)
				if err != nil {
					return err
				}
				return fmt.Errorf("genesis mismatch in Ref for Change %s: %s != %s", c, v.GenesisBlob, changeGenesis)
			}

			pendingChangesMap[cm.ID] = cm

			queue = append(queue, cm.Deps...)
		}

		// We have to apply changes in causal order to ensure correct heads tracking.
		pendingChanges := slices.Collect(maps.Values(pendingChangesMap))
		slices.SortFunc(pendingChanges, func(a, b changeMetadata) int {
			return cmp.Compare(a.Ts, b.Ts)
		})

		for _, cm := range pendingChanges {
			dg.ensureChangeApplied(cm)
		}

		if len(pendingChanges) > 0 {
			last := pendingChanges[len(pendingChanges)-1]
			if err := touchSpaceStats(conn, v.Space().String(), last.Ts); err != nil {
				return fmt.Errorf("failed to touch space stats: %w", err)
			}

			if ictx.mustTrackUnreads && !isTombstone {
				if err := ensureUnread(conn, iri); err != nil {
					return err
				}
			}
		}
	}

	if v.Redirect != nil {
		redirectTarget, err := v.RedirectIRI()
		if err != nil {
			return err
		}

		dg.Metadata.set("$db.redirect", redirectTarget, refTime)
	}

	if v.Visibility != "" {
		dg.Metadata.set("$db.visibility", string(v.Visibility), refTime)
	}

	if isTombstone {
		dg.LastTombstoneRefTime = max(dg.LastTombstoneRefTime, refTime)
	} else {
		dg.LastAliveRefTime = max(dg.LastAliveRefTime, refTime)
	}

	if err := dg.save(conn); err != nil {
		return err
	}

	return nil
}

func touchSpaceStats(conn *sqlite.Conn, spaceID string, lastChangeTime int64) error {
	return sqlitex.Exec(conn, qTouchSpaceStats(), nil, spaceID, lastChangeTime)
}

var qTouchSpaceStats = dqb.Str(`
	INSERT INTO spaces (id, last_change_time)
	VALUES (?, ?)
	ON CONFLICT (id) DO UPDATE SET last_change_time = MAX(spaces.last_change_time, excluded.last_change_time);
`)

type documentGeneration struct {
	shouldUpdate bool

	ResourceID           int64
	Heads                map[int64]struct{}
	Generation           int64
	GenesisChangeTime    int64
	LastChangeTime       int64
	LastTombstoneRefTime int64
	LastAliveRefTime     int64
	Genesis              string
	LastComment          int64
	LastCommentTime      int64
	CommentCount         int64
	Changes              *roaring64.Bitmap
	ChangeCount          int64
	Authors              []int64
	Metadata             DocIndexedAttrs
}

func (dg *documentGeneration) load(conn *sqlite.Conn, resource, generation int64, genesis string) (err error) {
	rows, discard, check := sqlitex.Query(conn, qLoadDocumentGeneration(), resource, generation, genesis).All()
	defer discard(&err)
	for row := range rows {
		err = dg.fromRow(row)
		break
	}
	if err := check(); err != nil {
		return err
	}

	if dg.ResourceID == 0 {
		dg.ResourceID = resource
		dg.Heads = make(map[int64]struct{})
		dg.Generation = generation
		dg.Genesis = genesis
		dg.Changes = roaring64.New()
		dg.Metadata = make(DocIndexedAttrs)
	}

	return nil
}

func (dg documentGeneration) loadAllByResource(conn *sqlite.Conn, resource int64) (out []documentGeneration, err error) {
	rows, discard, check := sqlitex.Query(conn, qLoadGenerationsForResource(), resource).All()
	defer discard(&err)
	for row := range rows {
		var dg documentGeneration
		if err := dg.fromRow(row); err != nil {
			return nil, fmt.Errorf("failed to decode document generation from row: %w", err)
		}

		out = append(out, dg)
	}
	if err := check(); err != nil {
		return nil, err
	}

	return out, nil
}

func (dg *documentGeneration) fromRow(row *sqlite.Stmt) error {
	dg.shouldUpdate = true

	inc := sqlite.NewIncrementor(0)
	dg.ResourceID = row.ColumnInt64(inc())
	dg.GenesisChangeTime = row.ColumnInt64(inc())
	dg.LastChangeTime = row.ColumnInt64(inc())
	dg.LastTombstoneRefTime = row.ColumnInt64(inc())
	dg.LastAliveRefTime = row.ColumnInt64(inc())
	dg.Generation = row.ColumnInt64(inc())
	dg.Genesis = row.ColumnText(inc())
	dg.LastComment = row.ColumnInt64(inc())
	dg.LastCommentTime = row.ColumnInt64(inc())
	dg.CommentCount = row.ColumnInt64(inc())
	dg.Heads = make(map[int64]struct{})

	headsJSON := row.ColumnBytesUnsafe(inc())
	var headsList []int64
	if len(headsJSON) > 0 {
		if err := json.Unmarshal(headsJSON, &headsList); err != nil {
			return err
		}
	}

	for _, h := range headsList {
		dg.Heads[h] = struct{}{}
	}

	dg.Changes = roaring64.New()
	changesRaw := row.ColumnBytes(inc())
	if len(changesRaw) > 0 {
		if _, err := dg.Changes.FromUnsafeBytes(changesRaw); err != nil {
			return fmt.Errorf("failed to parse bitmap: %w", err)
		}
	}

	dg.ChangeCount = row.ColumnInt64(inc())

	authorsJSON := row.ColumnBytesUnsafe(inc())
	if len(authorsJSON) > 0 {
		if err := json.Unmarshal(authorsJSON, &dg.Authors); err != nil {
			return err
		}
	}

	metadataJSON := row.ColumnBytesUnsafe(inc())
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &dg.Metadata); err != nil {
			return err
		}
	} else {
		dg.Metadata = make(DocIndexedAttrs)
	}

	return nil
}

var qLoadDocumentGeneration = dqb.Str(`
	SELECT
		resource,
		genesis_change_time,
		last_change_time,
		last_tombstone_ref_time,
		last_alive_ref_time,
		generation,
		genesis,
		last_comment,
		last_comment_time,
		comment_count,
		heads,
		changes,
		change_count,
		authors,
		metadata
	FROM document_generations
	WHERE resource = ?1
	AND generation = ?2
	AND genesis = ?3;
`)

var qLoadGenerationsForResource = dqb.Str(`
	SELECT
		resource,
		genesis_change_time,
		last_change_time,
		last_tombstone_ref_time,
		last_alive_ref_time,
		generation,
		genesis,
		last_comment,
		last_comment_time,
		comment_count,
		heads,
		changes,
		change_count,
		authors,
		metadata
	FROM document_generations
	WHERE resource = ?1;
`)

func (dg *documentGeneration) save(conn *sqlite.Conn) error {
	var q string
	if dg.shouldUpdate {
		q = qUpdateDocumentGeneration()
	} else {
		q = qInsertDocumentGeneration()
	}

	authorsJSON := unsafeutil.StringFromBytes(must.Do2(json.Marshal(dg.Authors)))
	metadataJSON := unsafeutil.StringFromBytes(must.Do2(json.Marshal(dg.Metadata)))
	changesBitmap, err := dg.Changes.ToBytes()
	if err != nil {
		return fmt.Errorf("failed to serialize bitmap: %w", err)
	}

	var lastComment maybe.Value[int64]
	if dg.LastComment != 0 {
		lastComment = maybe.New(dg.LastComment)
	}

	headsJSON := "[]"
	if len(dg.Heads) > 0 {
		heads := slices.Collect(maps.Keys(dg.Heads))
		slices.Sort(heads)

		headsJSON = unsafeutil.StringFromBytes(must.Do2(json.Marshal(heads)))
	}

	if err := sqlitex.Exec(conn, q, nil,
		dg.ResourceID,
		dg.Generation,
		dg.Genesis,
		lastComment.Any(),
		dg.LastCommentTime,
		dg.CommentCount,
		dg.ChangeCount,
		authorsJSON,
		metadataJSON,
		changesBitmap,
		dg.LastTombstoneRefTime,
		dg.LastAliveRefTime,
		dg.LastChangeTime,
		dg.GenesisChangeTime,
		headsJSON,
	); err != nil {
		return err
	}

	return nil
}

var qInsertDocumentGeneration = dqb.Str(`
	INSERT INTO document_generations (
		resource,
		generation,
		genesis,
		last_comment,
		last_comment_time,
		comment_count,
		change_count,
		authors,
		metadata,
		changes,
		last_tombstone_ref_time,
		last_alive_ref_time,
		last_change_time,
		genesis_change_time,
		heads
	)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`)

var qUpdateDocumentGeneration = dqb.Str(`
	UPDATE document_generations
	SET
		last_comment = ?4,
		last_comment_time = ?5,
		comment_count = ?6,
		change_count = ?7,
		authors = ?8,
		metadata = ?9,
		changes = ?10,
		last_tombstone_ref_time = ?11,
		last_alive_ref_time = ?12,
		last_change_time = ?13,
		genesis_change_time = ?14,
		heads = ?15
	WHERE (resource, generation, genesis) = (?1, ?2, ?3);
`)

func (dg *documentGeneration) containsAllChanges(changes []int64) bool {
	for _, c := range changes {
		if !dg.Changes.Contains(uint64(c)) {
			return false
		}
	}

	return true
}

func (dg *documentGeneration) ensureChangeApplied(cm changeMetadata) {
	// Add change to the set of applied changes.
	dg.Changes.Add(uint64(cm.ID))
	dg.ChangeCount++

	// A change with deps is the genesis change.
	// TODO(burdiyan): enfore there's only one genesis change.
	if len(cm.Deps) == 0 {
		dg.GenesisChangeTime = cm.Ts
	}

	dg.LastChangeTime = max(dg.LastChangeTime, cm.Ts)

	// Ensure indexed attributes are set,
	// unless newer values are already set.
	for k, v := range cm.ExtraAttrs.Metadata {
		dg.Metadata.set(k, v, cm.Ts)

		// When we set a key it means that we set it to a primitive value.
		// It's possible that previously there was a nested map in this key.
		// Because we store the keys as a flattened, we have to remove all the records
		// where our new key is a prefix, and the value is with lower timestamp than the incoming key.
		//
		// TODO(burdiyan): this is very complicated, and hard to reason about. Fix it!
		// There're other places in the code where this is done.
		// Search for "attrprefixhack" in the codebase.
		for kk, vv := range dg.Metadata {
			s := kk
			prefix := k
			if len(s) > len(prefix) && s[len(prefix)] == '.' && s[0:len(prefix)] == prefix && vv.Ts <= cm.Ts {
				delete(dg.Metadata, kk)
			}
		}
	}

	// Ensure author of the change is added to the set of authors.
	idx, found := slices.BinarySearch(dg.Authors, cm.Author)
	if !found {
		dg.Authors = slices.Insert(dg.Authors, idx, cm.Author)
	}

	for _, dep := range cm.Deps {
		delete(dg.Heads, dep)
	}
	dg.Heads[cm.ID] = struct{}{}
}

// IndexedValue is a attributes with timestamp for CRDT metadata.
type IndexedValue struct {
	Value any   `json:"v"`
	Ts    int64 `json:"t"`
}

// DocIndexedAttrs is a map of indexed document attributes with CRDT metadata.
type DocIndexedAttrs map[string]IndexedValue

func (m DocIndexedAttrs) set(k string, v any, ts int64) {
	vv, ok := m[k]
	if !ok {
		m[k] = IndexedValue{Value: v, Ts: ts}
		return
	}

	if vv.Ts == ts {
		// 1. We enforce that a given change only sets one value for the same key.
		// 2. We use millisecond timestamps in Changes, so we expect no 2 changes having the same ts.
		// 3. If they do, it's not an error in principle, but we don't handle this case right now.
		panic("TODO/BUG: setting value for the same key with duplicate ts")
	}

	if ts > vv.Ts {
		m[k] = IndexedValue{Value: v, Ts: ts}
	}
}

// PublicMap returns hydrated map attributes, doing proper nested map representation,
// by unfolding the attributes with dot separators and respecting the order of values.
// It also returns only public attributes, excluded those prefixed with `$db.`.
func (m DocIndexedAttrs) PublicMap() map[string]any {
	out := make(map[string]any, len(m))

	type KV struct {
		Key   string
		Value IndexedValue
	}
	kvs := make([]KV, 0, len(m))
	for k, v := range m {
		kvs = append(kvs, KV{Key: k, Value: v})
	}
	slices.SortFunc(kvs, func(a, b KV) int {
		if a.Value.Ts == b.Value.Ts {
			return cmp.Compare(a.Key, b.Key)
		}
		return cmp.Compare(a.Value.Ts, b.Value.Ts)
	})

	for _, kv := range kvs {
		if strings.HasPrefix(kv.Key, "$db.") || kv.Value.Value == nil {
			continue
		}

		colx.ObjectSet(out, strings.Split(kv.Key, "."), kv.Value.Value)
	}

	return out
}

type changeMetadata struct {
	shouldUpdate bool

	ID          int64
	Ts          int64
	Author      int64
	GenesisBlob int64
	ExtraAttrs  changeIndexedAttrs
	Deps        []int64
}

func (cm *changeMetadata) Genesis() int64 {
	switch {
	case len(cm.Deps) == 0 && cm.GenesisBlob == 0:
		return cm.ID
	case len(cm.Deps) > 0 && cm.GenesisBlob != 0:
		return cm.GenesisBlob
	default:
		panic("BUG: change must either have both deps and genesis or neither")
	}
}

func (cm *changeMetadata) load(conn *sqlite.Conn, id int64) (err error) {
	rows, discard, check := sqlitex.Query(conn, qLoadChangeMetadata(), id).All()
	defer discard(&err)
	for row := range rows {
		cm.shouldUpdate = true
		inc := sqlite.NewIncrementor(0)
		cm.ID = row.ColumnInt64(inc())
		cm.Ts = row.ColumnInt64(inc())
		cm.Author = row.ColumnInt64(inc())
		cm.GenesisBlob = row.ColumnInt64(inc())

		extraJSON := row.ColumnBytesUnsafe(inc())
		if len(extraJSON) > 0 {
			if err := json.Unmarshal(extraJSON, &cm.ExtraAttrs); err != nil {
				return err
			}
		}

		break
	}

	if err := check(); err != nil {
		return err
	}

	if cm.ID == 0 {
		return nil
	}

	rows, discard, check = sqlitex.Query(conn, qLoadChangeDeps(), id).All()
	defer discard(&err)

	for row := range rows {
		cm.Deps = append(cm.Deps, row.ColumnInt64(0))
	}

	if err := check(); err != nil {
		return err
	}

	return err
}

var qLoadChangeMetadata = dqb.Str(`
	SELECT
		id,
		ts,
		author,
		genesis_blob,
		extra_attrs
	FROM structural_blobs
	WHERE id = ?1;
`)

var qLoadChangeDeps = dqb.Str(`
	SELECT target
	FROM blob_links
	WHERE source = ?1
	AND type = 'change/dep';
`)
