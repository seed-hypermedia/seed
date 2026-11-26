package blob

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/attrkey"
	"seed/backend/util/dqb"
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
	"go.uber.org/zap"
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

	if err := Sign(kp, ru, &ru.BaseBlob.Sig); err != nil {
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

	if err := Sign(kp, ru, &ru.BaseBlob.Sig); err != nil {
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

			if err := Verify(v.Signer, v, v.Sig); err != nil {
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
	// For private Refs, the visibility space is the space the ref is for.
	var visibilitySpaces []core.Principal
	if v.Visibility == VisibilityPrivate {
		visibilitySpaces = []core.Principal{space}
	}
	if v.Ts.Equal(unixZero) {
		sb = newStructuralBlob(c, eb.Decoded.Type, v.Signer, v.Ts, iri, v.GenesisBlob, space, v.Ts, v.Visibility, visibilitySpaces)
	} else {
		sb = newStructuralBlob(c, eb.Decoded.Type, v.Signer, v.Ts, iri, v.GenesisBlob, space, time.Time{}, v.Visibility, visibilitySpaces)
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

// crossLinkRefMaybe validates a Ref against its document and records its
// effect on the document's generation, which the batch applies when it flushes.
//
// Everything that decides whether the Ref is valid happens here, so an invalid
// Ref is stashed like any other blob: its signer must be a writer, and its
// heads must be indexed Changes of its genesis. Indexing a Change requires its
// dependencies to be indexed Changes of the same genesis, so the whole history
// below valid heads is indexed and consistent, and applying the effect can't
// fail on missing or foreign changes.
func crossLinkRefMaybe(ictx *indexingCtx, v *Ref) error {
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
	ok, err := isValidWriter(conn, memberID, iri, ictx.batch)
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

	if resDB.ResourcesID == 0 {
		panic("BUG: resource ID is not indexed")
	}

	effect := refEffect{
		gen: generationKey{
			Resource:   resDB.ResourcesID,
			Generation: v.Generation,
			Genesis:    v.GenesisBlob.String(),
			IRI:        iri,
		},
		space:        v.Space().String(),
		tombstone:    v.IsTombstone(),
		ts:           v.Ts.UnixMilli(),
		visibility:   v.Visibility,
		trackUnreads: ictx.mustTrackUnreads,
	}

	if v.Redirect != nil {
		effect.redirect, err = v.RedirectIRI()
		if err != nil {
			return err
		}
	}

	if !effect.tombstone {
		genesis, err := ictx.ensureBlob(v.GenesisBlob)
		if err != nil {
			return err
		}

		for _, h := range v.Heads {
			head, err := ictx.indexedChange(h)
			if err != nil {
				return err
			}

			// A head that isn't indexed yet, stored or not, holds the Ref back:
			// it won't be visible until all of its heads are indexed.
			if head.ID == 0 {
				return stashError{
					Reason:   stashReasonFailedPrecondition,
					Metadata: stashMetadata{MissingBlobs: []cid.Cid{h}},
				}
			}

			if !head.IsChange || head.Genesis != genesis {
				return stashError{
					Reason: stashReasonBadData,
					Metadata: stashMetadata{
						Details: fmt.Sprintf("Ref head %s is not a Change of genesis %s", h, v.GenesisBlob),
					},
				}
			}

			effect.heads = append(effect.heads, head.ID)
		}
	}

	ictx.batch.refs = append(ictx.batch.refs, effect)

	return nil
}

// refEffect is what one Ref contributes to its document generation. See
// crossLinkRefMaybe and indexBatch.applyRefs.
type refEffect struct {
	gen          generationKey
	space        string
	heads        []int64
	tombstone    bool
	ts           int64
	redirect     IRI
	visibility   Visibility
	trackUnreads bool
}

// refStats counts the work of applying Refs, for diagnosing slow indexing.
type refStats struct {
	// Generations is how many times a generation was applied: once per
	// generation per flush that had Refs for it.
	Generations int

	// Seeded counts generations that started from the previous generation of
	// their document instead of replaying its history.
	Seeded int

	// ChangesApplied counts changes applied to generations.
	ChangesApplied int

	// Derived counts generations whose document fields were derived, and
	// ChangesDerived the changes those derivations replayed.
	Derived        int
	ChangesDerived int
}

// generationSeed is the state of a generation that comes from its changes
// alone, before any Ref sets its redirect, visibility, or times. The next
// generation of the same document can start from it.
type generationSeed struct {
	heads             map[int64]struct{}
	changes           *roaring64.Bitmap
	changeCount       int64
	genesisChangeTime int64
	lastChangeTime    int64
	authors           []int64
	attrs             DocIndexedAttrs
}

// applyRefs applies the batch's Ref effects to their document generations,
// loading and saving each generation once, and derives the document fields of
// the current generation of every document whose heads changed.
//
// It's equivalent to applying the Refs one by one in any order: a generation's
// changes are the union of what its Refs' heads reach, applied in timestamp
// order; ref times are maximums; redirect, visibility and authored attributes
// are last-writer-wins registers; and derived fields depend only on the final
// heads.
func (b *indexBatch) applyRefs(conn *sqlite.Conn, bs *blockStore, log *zap.Logger) error {
	if len(b.refs) == 0 {
		return nil
	}

	effects := make(map[generationKey][]refEffect)
	for _, e := range b.refs {
		effects[e.gen] = append(effects[e.gen], e)
	}

	b.refs = nil

	// Generations of one document are applied in order, so a later one can
	// start from an earlier one.
	keys := slices.SortedFunc(maps.Keys(effects), func(a, b generationKey) int {
		return cmp.Or(
			cmp.Compare(a.Resource, b.Resource),
			cmp.Compare(a.Genesis, b.Genesis),
			cmp.Compare(a.Generation, b.Generation),
		)
	})

	// The newest generation of each resource, among the stored ones and the
	// ones this flush applies. Only that one keeps its attributes, so only
	// that one is derived. See documentGeneration.save.
	current := make(map[int64]int64)
	for _, k := range keys {
		if _, ok := current[k.Resource]; !ok {
			stored, err := sqlitex.QueryOne[int64](conn, qMaxGeneration(), k.Resource)
			if err != nil {
				return err
			}
			current[k.Resource] = stored
		}

		current[k.Resource] = max(current[k.Resource], k.Generation)
	}

	var seed *generationSeed

	for i, k := range keys {
		// A seed comes only from the previous generation of the same document.
		if i > 0 && (keys[i-1].Resource != k.Resource || keys[i-1].Genesis != k.Genesis) {
			seed = nil
		}

		next, err := b.applyGeneration(conn, bs, log, k, effects[k], seed, current[k.Resource] == k.Generation)
		if err != nil {
			return err
		}

		seed = next
	}

	return nil
}

var qMaxGeneration = dqb.Str(`
	SELECT COALESCE(MAX(generation), 0) FROM document_generations WHERE resource = ?1;
`)

// applyGeneration applies the effects of one generation's Refs, and returns the
// seed for the next generation of the same document, which is nil when the
// generation wasn't built from scratch in this flush.
func (b *indexBatch) applyGeneration(conn *sqlite.Conn, bs *blockStore, log *zap.Logger, k generationKey, effects []refEffect, prev *generationSeed, isCurrent bool) (*generationSeed, error) {
	b.stats.Generations++

	var dg documentGeneration

	if err := dg.load(conn, k.Resource, k.Generation, k.Genesis); err != nil {
		return nil, err
	}

	// A seed holds what its generation's changes produced and nothing else,
	// which is exact only for a generation built from scratch, as this one is
	// when its row doesn't exist yet.
	fromScratch := !dg.shouldUpdate
	if !fromScratch {
		prev = nil
	}

	var heads []int64

	for _, e := range effects {
		heads = append(heads, e.heads...)
	}

	pending, seeded, err := b.walkChanges(conn, &dg, heads, prev)
	if err != nil {
		return nil, fmt.Errorf("failed to apply Refs of %s: %w", k.IRI, err)
	}

	if seeded {
		b.stats.Seeded++
		dg.Heads = maps.Clone(prev.heads)
		dg.Changes = prev.changes.Clone()
		dg.ChangeCount = prev.changeCount
		dg.GenesisChangeTime = prev.genesisChangeTime
		dg.LastChangeTime = prev.lastChangeTime
		dg.Authors = slices.Clone(prev.authors)
		dg.setMetadata(maps.Clone(prev.attrs))
	}

	// Changes are applied in causal order (not necessarily total order) to
	// track heads correctly.
	slices.SortFunc(pending, func(a, b changeMetadata) int {
		return cmp.Or(cmp.Compare(a.Ts, b.Ts), cmp.Compare(a.ID, b.ID))
	})

	for _, cm := range pending {
		dg.ensureChangeApplied(cm)
	}

	b.stats.ChangesApplied += len(pending)

	var next *generationSeed

	if fromScratch {
		next = &generationSeed{
			heads:             maps.Clone(dg.Heads),
			changes:           dg.Changes.Clone(),
			changeCount:       dg.ChangeCount,
			genesisChangeTime: dg.GenesisChangeTime,
			lastChangeTime:    dg.LastChangeTime,
			authors:           slices.Clone(dg.Authors),
			attrs:             maps.Clone(dg.Metadata),
		}
	}

	trackUnreads := false
	for _, e := range effects {
		if e.redirect != "" {
			dg.attrs().set("$db.redirect", e.redirect, e.ts)
		}

		dg.attrs().set("$db.visibility", string(e.visibility), e.ts)

		if e.tombstone {
			dg.LastTombstoneRefTime = max(dg.LastTombstoneRefTime, e.ts)
		} else {
			dg.LastAliveRefTime = max(dg.LastAliveRefTime, e.ts)
			trackUnreads = trackUnreads || e.trackUnreads
		}
	}

	resolvedVisibility := dg.Metadata["$db.visibility"]
	dg.Visibility = Visibility(resolvedVisibility.Value.(string))
	dg.VisibilityTimestamp = resolvedVisibility.Ts

	// The heads changed when changes were applied, and when a new generation
	// started from the previous one, even with nothing on top of it: a
	// replay from scratch would have applied the whole history. Every change
	// applied before this one touched the same space, so touching it with
	// the newest change time is the same as touching it with each new one.
	if len(pending) > 0 || seeded {
		if err := touchSpaceStats(conn, effects[0].space, dg.LastChangeTime); err != nil {
			return nil, fmt.Errorf("failed to touch space stats: %w", err)
		}

		if trackUnreads {
			if err := ensureUnread(conn, k.IRI); err != nil {
				return nil, err
			}
		}

		// Derived fields depend only on the final heads, so they're derived
		// once, and only when the heads changed.
		if isCurrent && b.deriveDocFields != nil && len(dg.Heads) > 0 {
			b.stats.Derived++
			b.stats.ChangesDerived += deriveDocFields(conn, bs, log, b.deriveDocFields, k.IRI, &dg)
		}
	}

	if err := dg.save(conn); err != nil {
		return nil, err
	}

	return next, nil
}

// walkChanges collects the changes that the heads reach and dg doesn't have
// yet. With prev, the walk stops at prev's changes; seeded reports that it
// reached all of prev's heads, in which case dg must start from prev, and
// pending holds only what's new on top of it. If it didn't, the walk is redone
// without prev.
func (b *indexBatch) walkChanges(conn *sqlite.Conn, dg *documentGeneration, heads []int64, prev *generationSeed) (pending []changeMetadata, seeded bool, err error) {
	if len(heads) == 0 {
		return nil, false, nil
	}

	genesis, err := b.genesisID(conn, dg.Genesis)
	if err != nil {
		return nil, false, err
	}

	walk := func(prev *generationSeed) (pending []changeMetadata, reachedPrev int, err error) {
		seen := make(map[int64]bool)
		queue := slices.Clone(heads)
		for len(queue) > 0 {
			change := queue[len(queue)-1]
			queue = queue[:len(queue)-1]

			if seen[change] || dg.Changes.Contains(uint64(change)) {
				continue
			}
			seen[change] = true

			if prev != nil && prev.changes.Contains(uint64(change)) {
				if _, ok := prev.heads[change]; ok {
					reachedPrev++
				}
				continue
			}

			cm, err := b.changeMetadata(conn, change)
			if err != nil {
				return nil, 0, err
			}

			// Refs check their heads, and Changes their dependencies, so a
			// valid head's history is indexed and belongs to its genesis.
			if cm.ID == 0 {
				return nil, 0, fmt.Errorf("BUG: change %d reachable from valid heads is not indexed", change)
			}

			if cm.Genesis() != genesis {
				return nil, 0, fmt.Errorf("BUG: change %d reachable from valid heads has genesis %d, not %d", change, cm.Genesis(), genesis)
			}

			pending = append(pending, cm)
			queue = append(queue, cm.Deps...)
		}

		return pending, reachedPrev, nil
	}

	if prev != nil {
		pending, reached, err := walk(prev)
		if err != nil {
			return nil, false, err
		}

		if reached == len(prev.heads) {
			return pending, true, nil
		}
	}

	pending, _, err = walk(nil)
	return pending, false, err
}

// genesisID returns the blob ID of a genesis change given its CID string. It's
// asked only for genesises with indexed heads, which are indexed themselves, so
// their IDs don't change for the rest of the transaction.
func (b *indexBatch) genesisID(conn *sqlite.Conn, genesis string) (int64, error) {
	if id, ok := b.genesises[genesis]; ok {
		return id, nil
	}

	c, err := cid.Decode(genesis)
	if err != nil {
		return 0, fmt.Errorf("invalid genesis %q: %w", genesis, err)
	}

	res, err := dbBlobsGetSize(conn, c.Hash(), false)
	if err != nil {
		return 0, err
	}

	b.genesises[genesis] = res.BlobsID

	return res.BlobsID, nil
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
	Visibility           Visibility
	VisibilityTimestamp  int64
	Genesis              string
	Changes              *roaring64.Bitmap
	ChangeCount          int64
	Authors              []int64
	Metadata             DocIndexedAttrs

	// metadataIndex indexes Metadata for writes. It's built on first use and
	// dropped whenever Metadata is replaced; see attrs.
	metadataIndex *attrIndex
}

// attrs returns the index every write to dg.Metadata goes through.
func (dg *documentGeneration) attrs() *attrIndex {
	if dg.metadataIndex == nil {
		dg.metadataIndex = newAttrIndex(dg.Metadata)
	}

	return dg.metadataIndex
}

// setMetadata replaces dg.Metadata, dropping the index of the previous map.
func (dg *documentGeneration) setMetadata(attrs DocIndexedAttrs) {
	dg.Metadata = attrs
	dg.metadataIndex = nil
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
		dg.setMetadata(make(DocIndexedAttrs))
	} else if err := dg.loadAttributes(conn); err != nil {
		return err
	}

	return nil
}

func (dg *documentGeneration) loadAttributes(conn *sqlite.Conn) (err error) {
	attrs, err := readDocumentAttributes(conn, dg.ResourceID, dg.Generation, dg.Genesis)
	if err != nil {
		return err
	}
	// Visibility is a last-writer-wins register stored in its own columns. It's
	// loaded back as an attribute even when public, the empty value, so a Ref
	// older than the stored one can't overwrite it.
	attrs["$db.visibility"] = IndexedValue{Key: "$db.visibility", Value: string(dg.Visibility), Ts: dg.VisibilityTimestamp, Kind: documentAttributeString}
	dg.setMetadata(attrs)
	return nil
}

func readDocumentAttributes(conn *sqlite.Conn, resource, generation int64, _ string) (attrs DocIndexedAttrs, err error) {
	attrs = make(DocIndexedAttrs)
	rows, discard, check := sqlitex.Query(conn, `SELECT dak.key, da.kind, da.value, da.timestamp, da.operation, da.actor FROM document_attributes da JOIN document_attribute_keys dak ON dak.id = da.key WHERE da.resource = ? AND ? = (SELECT MAX(generation) FROM document_generations WHERE resource = ?)`, resource, generation, resource).All()
	defer discard(&err)
	for row := range rows {
		key := row.ColumnText(0)
		kind := row.ColumnText(1)
		var value any
		switch kind {
		case documentAttributeNull:
			value = nil
		case documentAttributeString:
			value = row.ColumnText(2)
		case documentAttributeBool:
			value = row.ColumnInt64(2) != 0
		case documentAttributeInt:
			value = row.ColumnInt64(2)
		default:
			return nil, fmt.Errorf("unknown document attribute kind %q", kind)
		}
		attrs[key] = IndexedValue{
			Key:       key,
			Value:     value,
			Ts:        row.ColumnInt64(3),
			Operation: row.ColumnInt(4),
			Actor:     uint64(row.ColumnInt64(5)),
			Kind:      kind,
		}
	}
	return attrs, check()
}

func readDocumentRedirect(conn *sqlite.Conn, resource int64) (target IRI, ok bool, err error) {
	rows, discard, check := sqlitex.Query(conn, qReadDocumentRedirect(), resource).All()
	defer discard(&err)
	for row := range rows {
		kind := row.ColumnText(0)
		if kind != documentAttributeString {
			return "", false, fmt.Errorf("invalid document redirect kind %q", kind)
		}
		target = IRI(row.ColumnText(1))
		ok = true
		break
	}
	return target, ok, check()
}

var qReadDocumentRedirect = dqb.Str(`
	SELECT da.kind, da.value
	FROM document_attributes da
	WHERE da.resource = ?1
	AND da.key = (SELECT id FROM document_attribute_keys WHERE key = '$db.redirect');
`)

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
	dg.Visibility = Visibility(row.ColumnText(inc()))
	dg.VisibilityTimestamp = row.ColumnInt64(inc())

	dg.setMetadata(make(DocIndexedAttrs))

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
		heads,
		changes,
		change_count,
		authors,
		visibility,
		visibility_timestamp
	FROM document_generations
	WHERE resource = ?1
	AND generation = ?2
	AND genesis = ?3;
`)

func (dg *documentGeneration) save(conn *sqlite.Conn) error {
	var q string
	if dg.shouldUpdate {
		q = qUpdateDocumentGeneration()
	} else {
		q = qInsertDocumentGeneration()
	}

	authorsJSON := unsafeutil.StringFromBytes(must.Do2(json.Marshal(dg.Authors)))
	changesBitmap, err := dg.Changes.ToBytes()
	if err != nil {
		return fmt.Errorf("failed to serialize bitmap: %w", err)
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
		dg.ChangeCount,
		authorsJSON,
		changesBitmap,
		dg.LastTombstoneRefTime,
		dg.LastAliveRefTime,
		dg.LastChangeTime,
		dg.GenesisChangeTime,
		headsJSON,
		dg.Visibility,
		dg.VisibilityTimestamp,
	); err != nil {
		return err
	}

	var isCurrent bool
	if err := sqlitex.Exec(conn, `SELECT ? = MAX(generation) FROM document_generations WHERE resource = ?`, func(row *sqlite.Stmt) error {
		isCurrent = row.ColumnInt64(0) != 0
		return nil
	}, dg.Generation, dg.ResourceID); err != nil {
		return err
	}
	if !isCurrent {
		return nil
	}
	persisted, err := readDocumentAttributes(conn, dg.ResourceID, dg.Generation, dg.Genesis)
	if err != nil {
		return err
	}
	for key, attr := range dg.Metadata {
		if key == "$db.visibility" {
			continue
		}
		kind, value, err := documentAttributeValue(attr.Value)
		if err != nil {
			return fmt.Errorf("invalid document attribute %q: %w", attr.Key, err)
		}
		if current, ok := persisted[key]; ok && current.Kind == kind && current.Value == value && current.Ts == attr.Ts && current.Operation == attr.Operation && current.Actor == attr.Actor {
			continue
		}
		if err := sqlitex.Exec(conn, `
				INSERT OR IGNORE INTO document_attribute_keys (key, search_key)
				VALUES (?, ?)
			`, nil, key, attrkey.SearchKey(key)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn, `
				INSERT INTO document_attributes (resource, key, kind, value, timestamp, operation, actor)
				SELECT ?, dak.id, ?, ?, ?, ?, ?
				FROM document_attribute_keys dak
				WHERE dak.key = ?
				ON CONFLICT (resource, key) DO UPDATE SET
					kind = excluded.kind,
					value = excluded.value,
				timestamp = excluded.timestamp,
				operation = excluded.operation,
				actor = excluded.actor
			`, nil, dg.ResourceID, kind, value, attr.Ts, attr.Operation, int64(attr.Actor), //nolint:gosec // ActorID is derived from 56 bits.
			key); err != nil {
			return err
		}
	}
	for key := range persisted {
		if key == "$db.visibility" {
			continue
		}
		if _, ok := dg.Metadata[key]; ok {
			continue
		}
		if err := sqlitex.Exec(conn, `DELETE FROM document_attributes WHERE resource = ? AND key = (SELECT id FROM document_attribute_keys WHERE key = ?)`, nil, dg.ResourceID, key); err != nil {
			return err
		}
	}

	return nil
}

var qInsertDocumentGeneration = dqb.Str(`
	INSERT INTO document_generations (
		resource,
		generation,
		genesis,
		change_count,
		authors,
		changes,
		last_tombstone_ref_time,
		last_alive_ref_time,
		last_change_time,
		genesis_change_time,
		heads,
		visibility,
		visibility_timestamp
	)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`)

var qUpdateDocumentGeneration = dqb.Str(`
	UPDATE document_generations
	SET
		change_count = ?4,
		authors = ?5,
		changes = ?6,
		last_tombstone_ref_time = ?7,
		last_alive_ref_time = ?8,
		last_change_time = ?9,
		genesis_change_time = ?10,
		heads = ?11,
		visibility = ?12,
		visibility_timestamp = ?13
	WHERE (resource, generation, genesis) = (?1, ?2, ?3);
`)

const (
	documentAttributeNull   = "n"
	documentAttributeString = "s"
	documentAttributeBool   = "b"
	documentAttributeInt    = "i"
)

func documentAttributeValue(value any) (kind string, out any, err error) {
	switch value := value.(type) {
	case nil:
		return documentAttributeNull, nil, nil
	case string:
		return documentAttributeString, value, nil
	case IRI:
		return documentAttributeString, string(value), nil
	case bool:
		return documentAttributeBool, value, nil
	case int64:
		return documentAttributeInt, value, nil
	case int:
		return documentAttributeInt, int64(value), nil
	case float64:
		if math.Trunc(value) != value {
			return "", nil, fmt.Errorf("non-integral number %v", value)
		}
		return documentAttributeInt, int64(value), nil
	default:
		return "", nil, fmt.Errorf("unsupported value type %T", value)
	}
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
		dg.setAttribute(k, v, cm.Ts)
	}
	for _, attribute := range cm.ExtraAttrs.Attributes {
		dg.setAttributeOrdered(attribute.Key, attribute.Value, cm.Ts, attribute.Operation, cm.ExtraAttrs.Actor)
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

func (dg *documentGeneration) setAttribute(key string, value any, ts int64) {
	dg.setAttributeOrdered(key, value, ts, 0, 0)
}

func (dg *documentGeneration) setAttributeOrdered(key string, value any, ts int64, operation int, actor uint64) {
	// Changes indexed by older versions may contain structured values. They are
	// valid document data but cannot be represented in document_attributes.
	if _, _, err := documentAttributeValue(value); err != nil {
		return
	}
	dg.attrs().setOrdered(key, value, ts, operation, actor)
}

// IndexedValue is a attributes with timestamp for CRDT metadata.
type IndexedValue struct {
	Key       string `json:"key,omitempty"`
	Value     any    `json:"v"`
	Ts        int64  `json:"t"`
	Operation int    `json:"o,omitempty"`
	Actor     uint64 `json:"a,omitempty"`
	Kind      string `json:"k,omitempty"`
}

// FirstImageInContentAttr is the internal indexed-attrs key holding the
// derived fallback cover image (first image block in reading order). The
// "$db." prefix keeps it out of the public metadata map; it reaches clients
// as the typed DocumentInfo.first_image_in_content field instead. An empty
// value means "derived: the document has no content image"; a missing key
// means derivation hasn't run, or the document has an explicit cover or icon.
const FirstImageInContentAttr = "$db.firstImageInContent"

// IsCollectionAttr is the internal indexed-attrs key holding the derived
// Collection flag derived from document structure. Like FirstImageInContentAttr the
// "$db." prefix keeps it out of the public metadata map; it reaches clients as
// the typed DocumentInfo.is_collection field.
//
// Indexing derives it for every document generation with heads.
const IsCollectionAttr = "$db.isCollection"

// NavigationCardsAttr is the internal indexed-attrs key holding the derived
// navigation Cards (DerivedDocFields.NavigationCards) as a JSON array of hm://
// IRIs, because attribute values are scalars. Clients read it as the typed
// DocumentInfo.navigation_cards field, so the sidebar never loads documents.
//
// It is written in the same derivation as IsCollectionAttr, for every document
// generation with heads, so readers never need to load the document instead.
const NavigationCardsAttr = "$db.navigationCards"

// navigationCardsJSON encodes navigation Cards for NavigationCardsAttr.
func navigationCardsJSON(cards []string) string {
	if cards == nil {
		cards = []string{}
	}

	return unsafeutil.StringFromBytes(must.Do2(json.Marshal(cards)))
}

// DocIndexedAttrs is a map of indexed document attributes with CRDT metadata.
type DocIndexedAttrs map[string]IndexedValue

// deriveDocFields derives the document-level fields (fallback cover image,
// collection flag, navigation Cards) of dg from its merged heads, and stores
// them in dg's attributes. It returns how many changes it replayed.
//
// Derivation is best-effort: a document whose changes fail to load or whose
// derivation fails is logged, and still records the collection flag and
// navigation Cards as empty: the model cannot rebuild it, so it has no
// navigation and no Collection shape. See the failure branch for why the cover
// image is left alone.
func deriveDocFields(conn *sqlite.Conn, bs *blockStore, log *zap.Logger, derive DeriveDocFields, iri IRI, dg *documentGeneration) (changesReplayed int) {
	// Derived values replace the previous ones outright (see setDerived), so
	// the timestamp is only informational: the newest alive Ref.
	ts := dg.LastAliveRefTime

	headIDs := slices.Collect(maps.Keys(dg.Heads))
	changes, cerr := changesFromHeadIDsConn(conn, bs, headIDs, dg.Generation)
	if cerr != nil {
		log.Warn("FailedToLoadChangesForDerivedDocFields", zap.String("iri", string(iri)), zap.Error(cerr))
		dg.attrs().setDerived(IsCollectionAttr, false, ts)
		dg.attrs().setDerived(NavigationCardsAttr, navigationCardsJSON(nil), ts)
		return 0
	}

	fields, derr := derive(iri, changes)
	if derr != nil {
		log.Warn("FailedToDeriveDocFields", zap.String("iri", string(iri)), zap.Error(derr))

		// A document the model cannot rebuild has no navigation Cards and, in
		// practice, is an enormous one, which is overwhelmingly unlikely to have
		// the minimal Collection shape.
		//
		// The cover image is deliberately left alone. Empty there does not mean
		// "unknown", it means "derived, this document has no content image", and
		// clients act on it by skipping their fallback fetch — a claim this
		// failure gives no grounds to make.
		dg.attrs().setDerived(IsCollectionAttr, false, ts)
		dg.attrs().setDerived(NavigationCardsAttr, navigationCardsJSON(nil), ts)
		return len(changes)
	}

	// Always record the result — empty means "derived: no image" — so a value
	// derived at older heads can never outlive the image's removal, and clients
	// can skip the fallback document fetch entirely. An explicit cover or icon
	// makes the fallback moot, so it's dropped, which also keeps a value
	// derived before the cover was set from depending on whether both arrived
	// in one batch.
	//
	// The cover/icon gate must be evaluated in Go: hasNonEmptyAttr treats a nil
	// value and an empty string as absent but any non-string value as present.
	if !hasNonEmptyAttr(dg.Metadata, "cover") && !hasNonEmptyAttr(dg.Metadata, "icon") {
		dg.attrs().setDerived(FirstImageInContentAttr, fields.FirstImage, ts)
	} else {
		dg.attrs().remove(FirstImageInContentAttr)
	}
	dg.attrs().setDerived(IsCollectionAttr, fields.IsCollection, ts)
	dg.attrs().setDerived(NavigationCardsAttr, navigationCardsJSON(fields.NavigationCards), ts)

	return len(changes)
}

// generationKey identifies one document_generations row plus the IRI of its
// resource, which the derivation needs but the generation row doesn't carry.
type generationKey struct {
	Resource   int64
	Generation int64
	Genesis    string
	IRI        IRI
}

// hasNonEmptyAttr reports whether the indexed metadata map holds an effective
// (client-visible, non-empty) value for key k. A key can be present with a nil
// value (authored removal) or an empty string (cleared via the UI) — both mean
// "no cover/icon" for the fallback-cover derivation gate.
func hasNonEmptyAttr(m DocIndexedAttrs, k string) bool {
	v, ok := m[k]
	if !ok || v.Value == nil {
		return false
	}
	if s, isStr := v.Value.(string); isStr {
		return s != ""
	}
	return true
}

// attrIndex applies writes to a DocIndexedAttrs while keeping its key paths in
// sorted order. A key's descendants are then one contiguous run, found by binary
// search, so a write costs a few lookups instead of a pass over every key of
// the document. Every write to an indexed map must go through its index, or the
// sorted keys go stale.
type attrIndex struct {
	attrs DocIndexedAttrs
	keys  []string
}

func newAttrIndex(attrs DocIndexedAttrs) *attrIndex {
	return &attrIndex{attrs: attrs, keys: slices.Sorted(maps.Keys(attrs))}
}

// put stores v at k, adding k to the sorted keys if it's new.
func (ix *attrIndex) put(k string, v IndexedValue) {
	if _, ok := ix.attrs[k]; !ok {
		i, _ := slices.BinarySearch(ix.keys, k)
		ix.keys = slices.Insert(ix.keys, i, k)
	}

	ix.attrs[k] = v
}

// remove deletes k.
func (ix *attrIndex) remove(k string) {
	if i, ok := slices.BinarySearch(ix.keys, k); ok {
		ix.keys = slices.Delete(ix.keys, i, i+1)
	}

	delete(ix.attrs, k)
}

// descendants returns the key paths strictly below k. They all start with
// k + ".", so they sort between that and k + "/", '/' being the byte after '.'.
// The result aliases the index and is invalidated by the next put or remove.
func (ix *attrIndex) descendants(k string) []string {
	lo, _ := slices.BinarySearch(ix.keys, k+".")
	hi, _ := slices.BinarySearch(ix.keys, k+"/")

	return ix.keys[lo:hi]
}

func (ix *attrIndex) set(k string, v any, ts int64) {
	ix.setOrdered(k, v, ts, 0, 0)
}

// setDerived stores a value the indexer derived from a generation's merged
// heads. Unlike authored attributes it is not a last-writer-wins register: each
// derivation already reflects every change applied so far, so it replaces the
// previous value unconditionally. Ordering it by timestamp would be wrong — a
// late Ref with an older timestamp can still change the merged heads, and the
// value derived from them must win over one derived from fewer heads.
// Derived keys are flat "$db." keys with no ancestors or descendants.
func (ix *attrIndex) setDerived(k string, v any, ts int64) {
	kind, _, err := documentAttributeValue(v)
	if err != nil {
		panic(fmt.Errorf("BUG: invalid derived attribute value %T: %w", v, err))
	}

	ix.put(k, IndexedValue{Key: k, Value: v, Ts: ts, Kind: kind})
}

// setOrdered applies a write to an attribute key path. Key paths are dotted, and
// they form a tree: a write replaces everything above and below it that is
// older. The result must equal applying every write sorted by
// (ts, operation, actor) — the same order as docmodel's op IDs — whatever order
// the writes are indexed in, because changes reach the index across separate
// Refs and transactions in any order. The map holds at most one entry per path,
// a value or a tombstone (kind null), and a write follows these rules:
//
//  1. If the path itself or any ancestor has an entry at least as new, the
//     write is superseded and ignored. An exact tie on the same path falls back
//     to comparing the encoded values, so the winner stays deterministic.
//  2. Otherwise it replaces the path's entry and deletes every older descendant.
//  3. If a newer descendant exists, the write was already replaced by it, so it
//     is stored as a tombstone instead of a value.
//  4. Older ancestors holding a value become tombstones at their own order.
//
// A tombstone keeps its order because it still supersedes older writes below it
// that arrive later. Readers skip tombstones. This mirrors docmodel's
// setMetadata exactly; the two must agree.
func (ix *attrIndex) setOrdered(k string, v any, ts int64, operation int, actor uint64) {
	kind, _, err := documentAttributeValue(v)
	if err != nil {
		panic(fmt.Errorf("BUG: invalid indexed attribute value %T: %w", v, err))
	}
	vNew := IndexedValue{Key: k, Value: v, Ts: ts, Operation: operation, Actor: actor, Kind: kind}

	// Decide everything before mutating the map.
	if other, ok := ix.attrs[k]; ok {
		if order := compareIndexedOrder(other, vNew); order > 0 || order == 0 && !indexedValueWinsTie(vNew, other) {
			return
		}
	}

	// The ancestors of a.b.c are a and a.b: every prefix ending before a dot.
	var olderAncestors []string

	for i := range len(k) {
		if k[i] != '.' {
			continue
		}

		ancestor := k[:i]

		other, ok := ix.attrs[ancestor]
		if !ok {
			continue
		}

		if compareIndexedOrder(other, vNew) >= 0 {
			return
		}

		olderAncestors = append(olderAncestors, ancestor)
	}

	var olderDescendants []string

	newerDescendant := false
	for _, descendant := range ix.descendants(k) {
		if compareIndexedOrder(ix.attrs[descendant], vNew) > 0 {
			newerDescendant = true
		} else {
			olderDescendants = append(olderDescendants, descendant)
		}
	}

	if newerDescendant {
		vNew.Value = nil
		vNew.Kind = documentAttributeNull
	}

	ix.put(k, vNew)

	for _, descendant := range olderDescendants {
		ix.remove(descendant)
	}

	for _, ancestor := range olderAncestors {
		other := ix.attrs[ancestor]
		if other.Value != nil {
			other.Value = nil
			other.Kind = documentAttributeNull
			ix.attrs[ancestor] = other
		}
	}
}

// indexedValueWinsTie breaks an exact order tie between two writes to the same
// path by their deterministic CBOR encoding: the greater encoding wins.
func indexedValueWinsTie(vNew, vOld IndexedValue) bool {
	newValue, err := cbornode.DumpObject(vNew.Value)
	if err != nil {
		panic(fmt.Errorf("BUG: invalid CBOR new value to set %T: %w", vNew.Value, err))
	}

	oldValue, err := cbornode.DumpObject(vOld.Value)
	if err != nil {
		panic(fmt.Errorf("BUG: invalid CBOR old value to set %T: %w", vOld.Value, err))
	}

	return bytes.Compare(newValue, oldValue) > 0
}

func compareIndexedOrder(a, b IndexedValue) int {
	if order := cmp.Compare(a.Ts, b.Ts); order != 0 {
		return order
	}
	if order := cmp.Compare(a.Operation, b.Operation); order != 0 {
		return order
	}
	return cmp.Compare(a.Actor, b.Actor)
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
	for key, v := range m {
		if v.Key == "" {
			v.Key = key
		}
		kvs = append(kvs, KV{Key: v.Key, Value: v})
	}
	slices.SortFunc(kvs, func(a, b KV) int {
		if order := compareIndexedOrder(a.Value, b.Value); order != 0 {
			return order
		}
		return cmp.Compare(a.Key, b.Key)
	})

	for _, kv := range kvs {
		if strings.HasPrefix(kv.Key, "$db.") || kv.Value.Value == nil {
			continue
		}
		if kv.Value.Kind == documentAttributeBool {
			if value, ok := kv.Value.Value.(float64); ok {
				kv.Value.Value = value != 0
			}
		}

		attrkey.Set(out, strings.Split(kv.Key, "."), kv.Value.Value)
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
