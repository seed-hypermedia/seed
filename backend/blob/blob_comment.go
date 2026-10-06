package blob

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
	"github.com/polydawn/refmt/obj/atlas"
)

// TypeComment is the type of a Comment blob.
const TypeComment Type = "Comment"

func init() {
	cbornode.RegisterCborType(Comment{})

	cbornode.RegisterCborType(atlas.BuildEntry(CommentBlock{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in CommentBlock) (map[string]any, error) {
			var v map[string]any
			if err := mapstruct(in, &v); err != nil {
				return nil, err
			}

			return v, nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (CommentBlock, error) {
			var v CommentBlock
			if err := mapstruct(in, &v); err != nil {
				return v, err
			}
			return v, nil
		})).
		Complete(),
	)
}

// Comment is a blob that represents a comment to some document, or a reply to some other comment.
type Comment struct {
	BaseBlob
	ID           TSID           `refmt:"id,omitempty"`
	_            cid.Cid        `refmt:"capability,omitempty"` // deprecated
	Space_       core.Principal `refmt:"space,omitempty"`
	Path         string         `refmt:"path,omitempty"`
	Version      []cid.Cid      `refmt:"version,omitempty"`
	ThreadRoot   cid.Cid        `refmt:"threadRoot,omitempty"`
	ReplyParent_ cid.Cid        `refmt:"replyParent,omitempty"`
	Body         []CommentBlock `refmt:"body"`
	Visibility   Visibility     `refmt:"visibility,omitempty"`
}

// NewComment creates a new Comment blob.
func NewComment(
	kp *core.KeyPair,
	id TSID,
	space core.Principal,
	path string,
	version []cid.Cid,
	threadRoot cid.Cid,
	replyParent cid.Cid,
	body []CommentBlock,
	visibility Visibility,
	ts time.Time,
) (eb Encoded[*Comment], err error) {
	if threadRoot.Equals(replyParent) {
		replyParent = cid.Undef
	}

	cu := &Comment{
		ID: id,
		BaseBlob: BaseBlob{
			Type:   TypeComment,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Path:         path,
		Version:      version,
		ThreadRoot:   threadRoot,
		ReplyParent_: replyParent,
		Body:         body,
		Visibility:   visibility,
	}

	if !kp.Principal().Equal(space) {
		cu.Space_ = space
	}

	if err := Sign(kp, cu, &cu.BaseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cu)
}

// TSID implements the [ReplacementBlob] interface.
func (c *Comment) TSID() TSID {
	return c.ID
}

// ReplyParent is a convenience method to get the ReplyParent field.
// For initial replies we allow reply parent to be empty, because it's the same as the thread root,
// and this method will fallback to the ThreadRoot field in that case.
// Notice that if the comment is not a reply, thread root will be empty too.
func (c *Comment) ReplyParent() cid.Cid {
	if c.ReplyParent_.Defined() {
		return c.ReplyParent_
	}
	return c.ThreadRoot
}

// GetSpace returns the space for the comment.
// Field Space may be empty if it's the same as the signer.
func (c *Comment) Space() core.Principal {
	if len(c.Space_) == 0 {
		return c.Signer
	}
	return c.Space_
}

// CommentBlock is a block of text with annotations.
type CommentBlock struct {
	Block `mapstructure:",squash"`

	Children []CommentBlock `mapstructure:"children,omitempty"`
}

var commentTypeMatcher = makeCBORTypeMatch(TypeComment)

func init() {
	registerIndexer(TypeComment, decodeComment, indexComment)
}

// decodeComment parses raw blob bytes as a Comment, returning errSkipIndexing for
// anything else. Shared by the indexer registration and by the re-settlement
// paths that revisit an already indexed comment (see settleComment).
func decodeComment(c cid.Cid, data []byte) (eb Encoded[*Comment], err error) {
	codec, _ := ipfs.DecodeCID(c)
	if codec != multicodec.DagCbor || !bytes.Contains(data, commentTypeMatcher) {
		return eb, errSkipIndexing
	}

	// We validate the comment signature as an opaque map first,
	// because we messed up the encoding of comments previously.
	{
		var v map[string]any
		if err := cbornode.DecodeInto(data, &v); err != nil {
			return eb, err
		}

		signerBytes, ok := v["signer"].([]byte)
		if !ok {
			return eb, fmt.Errorf("signer field must be bytes, but got %T", v["signer"])
		}

		signatureBytes, ok := v["sig"].([]byte)
		if !ok {
			return eb, fmt.Errorf("sig field must be bytes, but got %T", v["sig"])
		}

		if err := Verify(core.Principal(signerBytes), v, signatureBytes); err != nil {
			return eb, err
		}
	}

	// Now we decode the CBOR again into a proper struct.

	v := &Comment{}
	if err := cbornode.DecodeInto(data, v); err != nil {
		return eb, err
	}

	eb.CID = c
	eb.Data = data
	eb.Decoded = v
	return eb, nil
}

func indexComment(ictx *indexingCtx, id int64, eb Encoded[*Comment]) error {
	c, v := eb.CID, eb.Decoded

	iri, err := NewIRI(v.Space(), v.Path)
	if err != nil {
		return fmt.Errorf("invalid comment target: %w", err)
	}

	// TODO: ignore comments for removed target resources.

	var (
		isReply     = v.ThreadRoot.Defined()
		threadRoot  = v.ThreadRoot
		replyParent = v.ReplyParent()
	)

	if replyParent.Defined() && !threadRoot.Defined() {
		return fmt.Errorf("comments with replyParent must have threadRoot")
	}

	var missingBlobs []cid.Cid
	if isReply {
		ok, err := ictx.IsBlobIndexed(threadRoot)
		if err != nil {
			return err
		}
		if !ok {
			missingBlobs = append(missingBlobs, threadRoot)
		}

		if !threadRoot.Equals(replyParent) {
			ok, err := ictx.IsBlobIndexed(replyParent)
			if err != nil {
				return err
			}
			if !ok {
				missingBlobs = append(missingBlobs, replyParent)
			}
		}
	}

	if missingBlobs != nil {
		return stashError{
			Reason: stashReasonFailedPrecondition,
			Metadata: stashMetadata{
				MissingBlobs: missingBlobs,
			},
		}
	}

	// Check if this is a tombstone (deleted comment)
	isTombstone := len(v.Body) == 0

	extraAttrs := make(map[string]any)

	// Comments have an explicit visibility field, which is usually inherited from the document they target.
	// For private comments, they're owned by both the signer and the target document's space.
	var visibilitySpaces []core.Principal
	if v.Visibility == VisibilityPrivate {
		visibilitySpaces = []core.Principal{v.Signer}
		// Also include the target space to allow the space owner to access comments on their documents.
		if !v.Signer.Equal(v.Space()) {
			visibilitySpaces = append(visibilitySpaces, v.Space())
		}
	}
	sb := newStructuralBlob(c, v.Type, v.Signer, v.Ts, iri, cid.Undef, v.Space(), time.Time{}, v.Visibility, visibilitySpaces)
	sb.ExtraAttrs = extraAttrs

	if v.Visibility != VisibilityPublic {
		extraAttrs["visibility"] = v.Visibility
	}

	extraAttrs["tsid"] = eb.TSID()

	// For tombstones, mark as deleted
	if isTombstone {
		extraAttrs["deleted"] = true
	}

	targetURI, err := url.Parse(string(iri))
	if err != nil {
		return err
	}

	targetVersion := NewVersion(v.Version...)
	if targetVersion != "" {
		q := targetURI.Query()
		q.Set("v", targetVersion.String())
		targetURI.RawQuery = q.Encode()
	}

	if err := indexURL(&sb, ictx.log, "", "comment/target", targetURI.String()); err != nil {
		return err
	}

	if threadRoot.Defined() {
		sb.AddBlobLink("comment/thread-root", threadRoot)
	}

	if replyParent.Defined() {
		sb.AddBlobLink("comment/reply-parent", replyParent)
	}

	const ftsType = "comment"
	var ftsContent string
	var ftsBlkID string
	var indexCommentContent func([]CommentBlock) error // Declaring function to allow recursive calls.
	indexCommentContent = func(in []CommentBlock) error {
		for _, blk := range in {
			if err := indexURL(&sb, ictx.log, blk.ID(), "comment/"+blk.Type, blk.Link); err != nil {
				return err
			}

			for _, a := range blk.Annotations {
				if err := indexURL(&sb, ictx.log, blk.ID(), "comment/"+a.Type, a.Link); err != nil {
					return err
				}
			}

			if err := indexCommentContent(blk.Children); err != nil {
				return err
			}
			ftsBlkID = blk.ID()
			ftsContent = blk.Text
			//if ftsContent != "" {
			if err := dbFTSInsertOrReplace(ictx.conn, ftsContent, ftsType, id, ftsBlkID, sb.CID.String(), sb.Ts, sb.GenesisBlob.Hash().String()); err != nil {
				return fmt.Errorf("failed to insert record in fts table: %w", err)
			}
			//}
		}

		return nil
	}

	if err := indexCommentContent(v.Body); err != nil {
		return err
	}

	if err := ictx.SaveBlob(sb); err != nil {
		return err
	}

	// If the comment we've just indexed was a reply parent of another comment we've seen before,
	// we need to reindex those comments.
	if err := reindexStashedBlobs(ictx.childOpts(), ictx.conn, stashReasonFailedPrecondition, c.String(), ictx.blockStore, ictx.log, ictx.writerCache, ictx.hookIDs); err != nil {
		return err
	}

	// SaveBlob above ensures the target resource, so it's in the map from here on.
	resourceID, ok := ictx.resources[iri]
	if !ok {
		panic("BUG: missing resource for comment target")
	}

	settled, err := settleComment(ictx, eb, resourceID)
	if err != nil {
		return err
	}
	if !settled {
		return nil
	}

	// These incremental updates run only on initial indexing, never on settlement retries.
	changeIDs := make([]int64, len(v.Version))
	for i, ver := range v.Version {
		changeIDs[i] = ictx.blobs[ver].BlobsID
	}

	// Update document generation comment stats.
	{
		// commentCountDelta computes how this blob changes the count of distinct,
		// non-deleted comment TSIDs for the target. Edits with the same TSID don't
		// change the count; tombstones decrement only when a previously-live version
		// existed; out-of-order arrivals (non-tombstone after tombstone) re-activate.
		delta, err := commentCountDelta(ictx.conn, id, eb.TSID(), isTombstone)
		if err != nil {
			return fmt.Errorf("failed to compute comment count delta for %s: %w", c, err)
		}

		generations, err := documentGeneration{}.loadAllByResource(ictx.conn, resourceID)
		if err != nil {
			return fmt.Errorf("failed to load generations for comment %s: %w", c, err)
		}

		for _, dg := range generations {
			if !dg.containsAllChanges(changeIDs) {
				continue
			}

			// Only let live (non-tombstone) versions advance the latest comment pointer.
			if !isTombstone {
				commentTime := v.Ts.UnixMilli()
				if commentTime > dg.LastCommentTime {
					dg.LastComment = id
					dg.LastCommentTime = commentTime
				}
			}
			dg.CommentCount += delta
			if dg.CommentCount < 0 {
				dg.CommentCount = 0
			}

			if err := dg.save(ictx.conn); err != nil {
				return err
			}
		}

		if ictx.mustTrackUnreads {
			if err := ensureUnread(ictx.conn, iri); err != nil {
				return err
			}
		}
	}

	return nil
}

// settleComment resolves the target document and recomputes the comment's live
// version, document stats, and space totals. It is safe to retry these writes.
// Unknown targets remain indexed and return false; a later Change or Ref retries
// settlement. Targets stored but not yet indexed return a stash error, preserving
// the existing dependency retry behavior during indexing and reindexing.
func settleComment(ictx *indexingCtx, eb Encoded[*Comment], resourceID int64) (settled bool, err error) {
	c, v := eb.CID, eb.Decoded

	var (
		genesisBlobID  int64
		pendingChanges []cid.Cid
	)
	for _, ver := range v.Version {
		if _, err := ictx.ensureBlob(ver); err != nil {
			return false, err
		}
		changeID := ictx.blobs[ver]

		var cm changeMetadata
		if err := cm.load(ictx.conn, changeID.BlobsID); err != nil {
			return false, err
		}

		if cm.ID == 0 {
			if changeID.BlobsSize < 0 {
				return false, nil
			}
			pendingChanges = append(pendingChanges, ver)
			continue
		}

		genesisBlobID = cm.Genesis()
	}

	if pendingChanges != nil {
		return false, stashError{
			Reason:   stashReasonFailedPrecondition,
			Metadata: stashMetadata{MissingBlobs: pendingChanges},
		}
	}

	// A comment that pins no target version means "the document at this path", so
	// its identity is whatever genesis that path currently resolves to.
	var genesis string
	if genesisBlobID != 0 {
		genesis, err = lookupBlobCID(ictx.conn, genesisBlobID)
	} else {
		genesis, err = lookupResourceGenesis(ictx.conn, resourceID)
	}
	if err != nil {
		return false, fmt.Errorf("failed to resolve target genesis for comment %s: %w", c, err)
	}

	// No generation at that path yet, so there is no document to attribute this to.
	// The Ref that creates one re-settles the comment.
	if genesis == "" {
		return false, nil
	}

	// Settle this comment's live version, its document's activity, and the space
	// total. None of these need a document generation, so they're settled the
	// moment the blob lands rather than waiting for a Ref.
	if err := updateCommentLive(ictx.conn, eb.TSID(), genesis); err != nil {
		return false, err
	}

	if err := updateDocumentCommentStats(ictx.conn, genesis); err != nil {
		return false, err
	}

	if err := updateSpaceCommentStats(ictx.conn, v.Space().String()); err != nil {
		return false, err
	}

	return true, nil
}

// commentCountDelta returns the change to apply to comment counts when indexing
// a Comment blob. A new TSID contributes +1, edits contribute 0, the first
// tombstone for a previously-live TSID contributes -1, and a live blob arriving
// after a tombstone (out-of-order P2P sync) re-activates the TSID for +1.
func commentCountDelta(conn *sqlite.Conn, currentID int64, tsid TSID, isTombstone bool) (delta int64, err error) {
	var priorAny, priorLive int64
	rows, discard, check := sqlitex.Query(conn, qCommentTSIDPriorVersions(), string(tsid), currentID).All()
	defer discard(&err)
	for row := range rows {
		row.Scan(&priorAny, &priorLive)
	}
	if cerr := check(); cerr != nil {
		return 0, cerr
	}

	// TODO(burdiyan): this process is a bit simplistic,
	// because it doesn't account for the possiblility of multiple tombstones for the same comment.
	// Although it would be a bit of an anomly — it's totally possible from the data model perspective.
	// And in that case this logic would undercount the total number of comments.
	//
	// One way to address this could be keeping max live and deleted timestamps,
	// and on every event decide whether we should increment, decrement, or leave the count unchanged.
	// We won't bother for now, because multiple tombstones shouldn't happen in a normal scenario.

	switch {
	case isTombstone && priorLive > 0:
		return -1, nil
	case isTombstone:
		return 0, nil
	case priorAny == 0:
		return 1, nil
	case priorLive == 0:
		// A tombstone existed before this live version arrived (out-of-order sync).
		return 1, nil
	default:
		return 0, nil
	}
}

var qCommentTSIDPriorVersions = dqb.Str(`
	SELECT
		COUNT(*) AS prior_any,
		COALESCE(SUM(CASE WHEN extra_attrs->>'deleted' IS NULL THEN 1 ELSE 0 END), 0) AS prior_live
	FROM structural_blobs
	WHERE type = 'Comment'
	  AND extra_attrs->>'tsid' = ?1
	  AND id != ?2;
`)

// resettleComments retries derived stats without replaying initial indexing's
// count increments or unread notifications.
func resettleComments(ictx *indexingCtx, query string, arg int64) (err error) {
	type pendingComment struct {
		resource int64
		c        cid.Cid
		data     []byte
	}

	// Collected first: settling writes to tables this query reads.
	var found []pendingComment
	rows, discard, check := sqlitex.Query(ictx.conn, query, arg).All()
	defer discard(&err)
	for row := range rows {
		inc := sqlite.NewIncrementor(0)
		var (
			resource = row.ColumnInt64(inc())
			codec    = row.ColumnInt64(inc())
			hash     = row.ColumnBytes(inc())
			rawData  = row.ColumnBytesUnsafe(inc())
			size     = row.ColumnInt64(inc())
		)

		data, err := ictx.blockStore.decompress(rawData, int(size))
		if err != nil {
			return err
		}

		found = append(found, pendingComment{
			resource: resource,
			c:        cid.NewCidV1(uint64(codec), hash),
			data:     data,
		})
	}
	if err := check(); err != nil {
		return err
	}

	for _, pc := range found {
		eb, err := decodeComment(pc.c, pc.data)
		if err != nil {
			return fmt.Errorf("failed to decode pending comment %s: %w", pc.c, err)
		}

		// Still pending (another target change is missing, or still no generation):
		// a later arrival will get it. Nothing to stash from here -- a stash error
		// would roll back the blob that triggered this re-settlement.
		if _, err := settleComment(ictx, eb, pc.resource); err != nil {
			var pending stashError
			if errors.As(err, &pending) {
				continue
			}
			return fmt.Errorf("failed to settle pending comment %s: %w", pc.c, err)
		}
	}

	return nil
}

// Retry only the latest version of each comment, using the same (ts, id) order
// as comment_live. A deleted winner must exclude all of its historical versions.
const pendingCommentColumns = `
	SELECT sb.resource, b.codec, b.multihash, b.data, b.size
	FROM structural_blobs sb
	JOIN blobs b ON b.id = sb.id
`

const pendingCommentFilter = `
	AND sb.type = 'Comment'
	AND sb.extra_attrs->>'deleted' IS NULL
	AND sb.id = (
		SELECT latest.id FROM structural_blobs latest
		WHERE latest.type = 'Comment'
		AND latest.extra_attrs->>'tsid' = sb.extra_attrs->>'tsid'
		ORDER BY latest.ts DESC, latest.id DESC
		LIMIT 1
	)
	AND NOT EXISTS (SELECT 1 FROM comment_live l WHERE l.tsid = sb.extra_attrs->>'tsid')
`

var qPendingCommentsTargetingChange = dqb.Str(pendingCommentColumns + `
	WHERE sb.id IN (SELECT bl.source FROM blob_links bl WHERE bl.target = ?1 AND bl.type = 'comment/target')
` + pendingCommentFilter)

var qPendingCommentsOnResource = dqb.Str(pendingCommentColumns + `
	WHERE sb.resource = ?1
` + pendingCommentFilter)
