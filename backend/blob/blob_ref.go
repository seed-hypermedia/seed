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
	ok, err := isValidWriter(conn, memberID, iri, ictx.writerCache)
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

	// Whether this Ref advanced the generation's state (applied at least one
	// change the generation hadn't seen). Duplicate and out-of-date Refs leave
	// it false, letting the cover-image derivation below skip its full history
	// replay when the merged heads are unchanged.
	var appliedNewChanges bool

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

		// We have to apply changes in causal order (not necessarily total order)
		// to ensure correct heads tracking.
		pendingChanges := slices.Collect(maps.Values(pendingChangesMap))
		slices.SortFunc(pendingChanges, func(a, b changeMetadata) int {
			if c := cmp.Compare(a.Ts, b.Ts); c != 0 {
				return c
			}
			return cmp.Compare(a.ID, b.ID)
		})

		for _, cm := range pendingChanges {
			dg.ensureChangeApplied(cm)
		}

		if len(pendingChanges) > 0 {
			appliedNewChanges = true
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

	dg.Metadata.set("$db.visibility", string(v.Visibility), refTime)
	resolvedVisibility := dg.Metadata["$db.visibility"]
	dg.Visibility = Visibility(resolvedVisibility.Value.(string))
	dg.VisibilityTimestamp = resolvedVisibility.Ts

	// Derive a fallback cover image (the first image block in reading order) for
	// documents that carry neither an explicit cover nor icon, so directory cards
	// can render a thumbnail from fast metadata instead of fetching each child's
	// full document. Stored under an internal "$db." key (stripped by PublicMap,
	// so it never pollutes user-authored metadata) and exposed as the typed
	// DocumentInfo.first_image_in_content field. Best-effort: a derivation
	// failure is logged but must not fail Ref indexing.
	//
	// Derives from the generation's MERGED heads (what the read path renders),
	// and only when this Ref actually advanced them — duplicate and out-of-date
	// Refs can't change the result, so they skip the full history replay.
	if !isTombstone && appliedNewChanges && ictx.deriveFirstContentImage != nil && len(dg.Heads) > 0 {
		headIDs := slices.Collect(maps.Keys(dg.Heads))
		changes, cerr := changesFromHeadIDsConn(conn, ictx.blockStore, headIDs, v.Generation)
		if cerr != nil {
			ictx.log.Warn("FailedToLoadChangesForCoverImage", zap.String("iri", string(iri)), zap.Error(cerr))
		} else if firstImage, isFolder, derr := ictx.deriveFirstContentImage(iri, changes); derr != nil {
			ictx.log.Warn("FailedToDeriveCoverImage", zap.String("iri", string(iri)), zap.Error(derr))
		} else {
			// Always record the result — empty means "derived: no image" — so a
			// value derived at older heads can never outlive the image's removal,
			// and clients can skip the fallback document fetch entirely. The
			// timestamp rides at the generation's latest alive Ref time so that a
			// late-arriving older Ref which completes the merge still wins the
			// LWW register over a value derived from fewer heads.
			if !hasNonEmptyAttr(dg.Metadata, "cover") && !hasNonEmptyAttr(dg.Metadata, "icon") {
				dg.Metadata.set(FirstImageInContentAttr, firstImage, max(refTime, dg.LastAliveRefTime))
			}
			dg.Metadata.set(DocumentTypeAttr, map[bool]string{true: "folder", false: "document"}[isFolder], max(refTime, dg.LastAliveRefTime))
		}
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
	Visibility           Visibility
	VisibilityTimestamp  int64
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
	} else if err := dg.loadAttributes(conn); err != nil {
		return err
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
	for i := range out {
		if err := out[i].loadAttributes(conn); err != nil {
			return nil, err
		}
	}

	return out, nil
}

func (dg *documentGeneration) loadAttributes(conn *sqlite.Conn) (err error) {
	attrs, err := readDocumentAttributes(conn, dg.ResourceID, dg.Generation, dg.Genesis)
	if err != nil {
		return err
	}
	if dg.Visibility != "" {
		attrs["$db.visibility"] = IndexedValue{Key: "$db.visibility", Value: string(dg.Visibility), Ts: dg.VisibilityTimestamp, Kind: documentAttributeString}
	}
	dg.Metadata = attrs
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
	dg.Visibility = Visibility(row.ColumnText(inc()))
	dg.VisibilityTimestamp = row.ColumnInt64(inc())

	dg.Metadata = make(DocIndexedAttrs)

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
		visibility,
		visibility_timestamp
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
		visibility,
		visibility_timestamp
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
		last_comment,
		last_comment_time,
		comment_count,
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
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`)

var qUpdateDocumentGeneration = dqb.Str(`
	UPDATE document_generations
	SET
		last_comment = ?4,
		last_comment_time = ?5,
		comment_count = ?6,
		change_count = ?7,
		authors = ?8,
		changes = ?9,
		last_tombstone_ref_time = ?10,
		last_alive_ref_time = ?11,
		last_change_time = ?12,
		genesis_change_time = ?13,
		heads = ?14,
		visibility = ?15,
		visibility_timestamp = ?16
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
	dg.Metadata.setOrdered(key, value, ts, operation, actor)
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
// means derivation hasn't run.
const FirstImageInContentAttr = "$db.firstImageInContent"

// DocumentTypeAttr is the internal indexed-attrs key holding the derived document type.
const DocumentTypeAttr = "$db.documentType"

// DocIndexedAttrs is a map of indexed document attributes with CRDT metadata.
type DocIndexedAttrs map[string]IndexedValue

// deriveFirstContentImages derives the fallback cover image once per document
// generation, from that generation's final merged heads.
//
// This is the full-reindex counterpart of the per-Ref derivation in
// crossLinkRefMaybe. Incrementally, deriving per Ref is correct and cheap: a
// new Ref replays a history that grew by one change. In a full reindex it is
// quadratic per document — every Ref that advances the heads replays the whole
// history again. On a real 82k-blob database that is ~680k change replays
// against ~19k changes, and it dominated the entire reindex.
//
// Running once at the end is equivalent because the derivation only ever reads
// the merged head set, and heads merge commutatively: whatever order the blob
// loop visited Refs in, the final head set is the same one the last advancing
// Ref would have derived from.
//
// Best-effort, matching the per-Ref path: a generation whose changes fail to
// load or whose derivation fails is logged and skipped, never fatal.
func deriveFirstContentImages(conn *sqlite.Conn, bs *blockStore, log *zap.Logger, derive DeriveFirstContentImage) (scanned, derived, changesReplayed int, err error) {
	if derive == nil {
		return 0, 0, 0, nil
	}

	// Collect every key before writing anything: dg.save below writes to
	// document_generations, which is the same table this query scans. See the
	// same hazard called out in reindexStashedBlobs.
	keys, err := loadGenerationKeys(conn)
	if err != nil {
		return 0, 0, 0, err
	}

	for _, k := range keys {
		scanned++

		var dg documentGeneration
		if err := dg.load(conn, k.Resource, k.Generation, k.Genesis); err != nil {
			return scanned, derived, changesReplayed, err
		}

		// The query already filters out empty head sets, but load() synthesizes a
		// blank generation when the row is missing, so re-check the same condition
		// the per-Ref path guards on.
		if len(dg.Heads) == 0 {
			continue
		}

		// Must be evaluated in Go, not folded into the SQL filter above:
		// hasNonEmptyAttr treats a nil value and an empty string as absent but any
		// non-string value as present, which metadata->>'$.cover.v' cannot express.
		headIDs := slices.Collect(maps.Keys(dg.Heads))
		changes, cerr := changesFromHeadIDsConn(conn, bs, headIDs, dg.Generation)
		if cerr != nil {
			log.Warn("FailedToLoadChangesForCoverImage", zap.String("iri", string(k.IRI)), zap.Error(cerr))
			continue
		}
		changesReplayed += len(changes)

		firstImage, isFolder, derr := derive(k.IRI, changes)
		if derr != nil {
			log.Warn("FailedToDeriveCoverImage", zap.String("iri", string(k.IRI)), zap.Error(derr))
			continue
		}

		// LastAliveRefTime is already the max over every alive Ref of this
		// generation, which is exactly what max(refTime, dg.LastAliveRefTime) in
		// the per-Ref path resolves to once the last Ref has been applied.
		if !hasNonEmptyAttr(dg.Metadata, "cover") && !hasNonEmptyAttr(dg.Metadata, "icon") {
			dg.Metadata.set(FirstImageInContentAttr, firstImage, dg.LastAliveRefTime)
		}
		dg.Metadata.set(DocumentTypeAttr, map[bool]string{true: "folder", false: "document"}[isFolder], dg.LastAliveRefTime)

		if err := dg.save(conn); err != nil {
			return scanned, derived, changesReplayed, err
		}
		derived++
	}

	return scanned, derived, changesReplayed, nil
}

// generationKey identifies one document_generations row plus the IRI of its
// resource, which the derivation needs but the generation row doesn't carry.
type generationKey struct {
	Resource   int64
	Generation int64
	Genesis    string
	IRI        IRI
}

func loadGenerationKeys(conn *sqlite.Conn) (keys []generationKey, err error) {
	rows, discard, check := sqlitex.Query(conn, qLoadGenerationKeys()).All()
	defer discard(&err)
	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		keys = append(keys, generationKey{
			Resource:   row.ColumnInt64(inc()),
			Generation: row.ColumnInt64(inc()),
			Genesis:    row.ColumnText(inc()),
			IRI:        IRI(row.ColumnText(inc())),
		})
	}
	if err := check(); err != nil {
		return nil, err
	}

	return keys, nil
}

// Deliberately does not filter on is_deleted: a tombstone Ref never derives
// (the !isTombstone guard) but also never clears what earlier alive Refs set,
// and it leaves heads intact — deleted generations legitimately carry the
// derived value and must keep being refreshed.
var qLoadGenerationKeys = dqb.Str(`
	SELECT
		dg.resource,
		dg.generation,
		dg.genesis,
		r.iri
	FROM document_generations dg
	JOIN resources r ON r.id = dg.resource
	WHERE json_array_length(dg.heads) > 0
	ORDER BY dg.resource, dg.generation;
`)

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

func (m DocIndexedAttrs) set(k string, v any, ts int64) {
	m.setOrdered(k, v, ts, 0, 0)
}

func (m DocIndexedAttrs) setOrdered(k string, v any, ts int64, operation int, actor uint64) {
	kind, _, err := documentAttributeValue(v)
	if err != nil {
		panic(fmt.Errorf("BUG: invalid indexed attribute value %T: %w", v, err))
	}
	vNew := IndexedValue{Key: k, Value: v, Ts: ts, Operation: operation, Actor: actor, Kind: kind}
	vOld, ok := m[k]
	accepted := false
	if !ok {
		m[k] = vNew
		accepted = true
	} else {
		switch order := compareIndexedOrder(vOld, vNew); {
		case order < 0:
			m[k] = vNew
			accepted = true
		case order == 0:
			// When timestamps are equal, we use values as tie-breaker.
			// To deterministically compare unknown values we simply encode them as deterministic CBOR,
			// and compare the resulting byte slices. If new value is greater — it wins.

			newValue, err := cbornode.DumpObject(vNew.Value)
			if err != nil {
				panic(fmt.Errorf("BUG: invalid CBOR new value to set %T: %w", v, err))
			}

			oldValue, err := cbornode.DumpObject(vOld.Value)
			if err != nil {
				panic(fmt.Errorf("BUG: invalid CBOR old value to set %T: %w", v, err))
			}

			if bytes.Compare(newValue, oldValue) > 0 {
				m[k] = vNew
				accepted = true
			}
		case order > 0:
			break // Leaving the old value.
		default:
			panic("BUG: unreachable")
		}
	}
	if !accepted {
		return
	}

	// Keep only the structural LWW frontier. Tombstones participate so an old
	// parent or child cannot reappear when the replacing path is later deleted.
	for otherKey, other := range m {
		if otherKey == k {
			continue
		}

		otherIsAncestor := len(otherKey) < len(k) &&
			k[len(otherKey)] == '.' &&
			k[:len(otherKey)] == otherKey
		otherIsDescendant := len(k) < len(otherKey) &&
			otherKey[len(k)] == '.' &&
			otherKey[:len(k)] == k
		if !otherIsAncestor && !otherIsDescendant {
			continue
		}

		order := compareIndexedOrder(other, vNew)
		if order > 0 || order == 0 && otherIsDescendant {
			delete(m, k)
			return
		}
		delete(m, otherKey)
	}
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
