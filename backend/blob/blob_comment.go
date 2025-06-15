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

const blobTypeComment Type = "Comment"

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
	Capability   cid.Cid        `refmt:"capability,omitempty"`
	Space_       core.Principal `refmt:"space,omitempty"`
	Path         string         `refmt:"path,omitempty"`
	Version      []cid.Cid      `refmt:"version,omitempty"`
	ThreadRoot   cid.Cid        `refmt:"threadRoot,omitempty"`
	ReplyParent_ cid.Cid        `refmt:"replyParent,omitempty"`
	Body         []CommentBlock `refmt:"body"`
}

// NewComment creates a new Comment blob.
func NewComment(
	kp *core.KeyPair,
	cpb cid.Cid,
	space core.Principal,
	path string,
	version []cid.Cid,
	threadRoot cid.Cid,
	replyParent cid.Cid,
	body []CommentBlock,
	ts time.Time,
) (eb Encoded[*Comment], err error) {
	if threadRoot.Equals(replyParent) {
		replyParent = cid.Undef
	}
	cu := &Comment{
		BaseBlob: BaseBlob{
			Type:   blobTypeComment,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Capability:   cpb,
		Path:         path,
		Version:      version,
		ThreadRoot:   threadRoot,
		ReplyParent_: replyParent,
		Body:         body,
	}

	if !kp.Principal().Equal(space) {
		cu.Space_ = space
	}

	if err := signBlob(kp, cu, &cu.BaseBlob.Sig); err != nil {
		return eb, err
	}

	return encodeBlob(cu)
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

func init() {
	matcher := makeCBORTypeMatch(blobTypeComment)

	registerIndexer(blobTypeComment,
		func(c cid.Cid, data []byte) (eb Encoded[*Comment], err error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
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

				if err := verifyBlob(core.Principal(signerBytes), v, signatureBytes); err != nil {
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
		},
		indexComment,
	)
}

func indexComment(ictx *indexingCtx, id int64, eb Encoded[*Comment]) error {
	c, v := eb.CID, eb.Decoded

	iri, err := NewIRI(v.Space(), v.Path)
	if err != nil {
		return fmt.Errorf("invalid comment target: %v", err)
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

	if isReply {
		bp, err := ictx.GetBlobPresence(threadRoot)
		if err != nil {
			return err
		}
		if bp != BlobPresenceHasData {
			return ictx.Stash(stashReasonFailedPrecondition, stashMetadata{
				MissingBlobs: []cid.Cid{threadRoot},
			})
		}

		if !threadRoot.Equals(replyParent) {
			bp, err := ictx.GetBlobPresence(replyParent)
			if err != nil {
				return err
			}
			if bp != BlobPresenceHasData {
				return ictx.Stash(stashReasonFailedPrecondition, stashMetadata{
					MissingBlobs: []cid.Cid{replyParent},
				})
			}
		}
	}

	extraAttrs := make(map[string]any)
	sb := newStructuralBlob(c, v.Type, v.Signer, v.Ts, iri, cid.Undef, v.Space(), time.Time{})
	sb.ExtraAttrs = extraAttrs

	extraAttrs["tsid"] = eb.TSID()

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

	if v.Capability.Defined() {
		sb.AddBlobLink("comment/capability", v.Capability)
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
			if ftsContent != "" {
				if err := dbFTSInsertOrReplace(ictx.conn, ftsContent, ftsType, id, ftsBlkID, sb.CID.String()); err != nil {
					return fmt.Errorf("failed to insert record in fts table: %w", err)
				}
			}
		}

		return nil
	}

	if err := indexCommentContent(v.Body); err != nil {
		return err
	}

	if err := ictx.SaveBlob(sb); err != nil {
		return err
	}

	spaceID := v.Space().String()

	// Update space comment stats.
	{
		changeIDs := make([]int64, len(v.Version))
		for i, v := range v.Version {
			changeID, ok := ictx.blobs[v]
			if !ok {
				return fmt.Errorf("BUG: missing change for version %v when indexing comment target", v)
			}

			var cm changeMetadata
			if err := cm.load(ictx.conn, changeID.BlobsID); err != nil {
				return err
			}

			// If some of the comment target changes are not indexed yet, we skip updating any stats,
			// because we don't know what document generation to update.
			// We'll get to that later, if we ever receive a Ref that would incorporate those changes.
			if cm.ID == 0 {
				return nil
			}

			changeIDs[i] = cm.ID
		}

		resourceID, ok := ictx.resources[iri]
		if !ok {
			panic("BUG: missing resource for comment target")
		}

		generations, err := documentGeneration{}.loadAllByResource(ictx.conn, resourceID)
		if err != nil {
			return fmt.Errorf("failed to load generations for comment %s: %w", c, err)
		}

		for _, dg := range generations {
			if !dg.containsAllChanges(changeIDs) {
				continue
			}

			commentTime := v.Ts.UnixMilli()
			if commentTime > dg.LastCommentTime {
				dg.LastComment = id
				dg.LastCommentTime = commentTime
			}
			dg.CommentCount++

			if err := dg.save(ictx.conn); err != nil {
				return err
			}
		}

		var sm spaceCommentStats
		if err := sm.load(ictx.conn, spaceID); err != nil {
			return err
		}

		if commentTime := v.Ts.UnixMilli(); commentTime > sm.LastCommentTime {
			sm.LastCommentTime = commentTime
			sm.LastComment = id
		}

		sm.CommentCount++

		if err := sm.save(ictx.conn); err != nil {
			return err
		}

		if ictx.mustTrackUnreads {
			if err := ensureUnread(ictx.conn, iri); err != nil {
				return err
			}
		}
	}

	// If the comment we've just indexed was a reply parent of another comment we've seen before,
	// we need to reindex those comments.
	if err := reindexStashedBlobs(ictx.mustTrackUnreads, ictx.conn, stashReasonFailedPrecondition, c.String(), ictx.blockStore, ictx.log); err != nil {
		return err
	}

	return nil
}

type spaceCommentStats struct {
	shouldUpdate bool

	ID              string
	LastComment     int64
	LastCommentTime int64
	CommentCount    int64
}

func (sm *spaceCommentStats) load(conn *sqlite.Conn, spaceID string) (err error) {
	sm.ID = spaceID

	rows, check := sqlitex.Query(conn, qLoadSpaceCommentStats(), spaceID)
	for row := range rows {
		sm.shouldUpdate = true
		row.Scan(&sm.LastComment, &sm.LastCommentTime, &sm.CommentCount)
		break
	}

	err = errors.Join(err, check())
	if err != nil {
		return err
	}

	return nil
}

var qLoadSpaceCommentStats = dqb.Str(`
	SELECT
		last_comment,
		last_comment_time,
		comment_count
	FROM spaces
	WHERE id = :id;
`)

func (sm *spaceCommentStats) save(conn *sqlite.Conn) error {
	var q string
	if sm.shouldUpdate {
		q = qUpdateSpaceCommentStats()
	} else {
		q = qInsertSpaceCommentStats()
	}

	return sqlitex.Exec(conn, q, nil, sm.ID, sm.LastComment, sm.LastCommentTime, sm.CommentCount)
}

var qInsertSpaceCommentStats = dqb.Str(`
	INSERT INTO spaces (id, last_comment, last_comment_time, comment_count)
	VALUES (?1, ?2, ?3, ?4);
`)

var qUpdateSpaceCommentStats = dqb.Str(`
	UPDATE spaces
	SET
		last_comment = ?2,
		last_comment_time = ?3,
		comment_count = ?4
	WHERE id = ?1;
`)
