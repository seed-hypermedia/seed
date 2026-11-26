package blob

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
	"github.com/multiformats/go-multihash"
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
	Account      core.Principal `refmt:"account,omitempty"`
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
	account core.Principal,
	space core.Principal,
	path string,
	version []cid.Cid,
	threadRoot cid.Cid,
	replyParent cid.Cid,
	body []CommentBlock,
	visibility Visibility,
	ts time.Time,
) (eb Encoded[*Comment], err error) {
	if account == nil {
		return eb, fmt.Errorf("comment account cannot be nil")
	}

	if len(version) == 0 {
		return eb, errCommentNoVersion
	}

	if threadRoot.Equals(replyParent) {
		replyParent = cid.Undef
	}

	if kp.Principal().Equal(account) {
		account = nil
	}

	cu := &Comment{
		ID: id,
		BaseBlob: BaseBlob{
			Type:   TypeComment,
			Signer: kp.Principal(),
			Ts:     ts,
		},
		Account:      account,
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

// Authority returns the stable account authority represented by this comment.
// Legacy and directly signed comments omit Account and remain owned by their signer.
func (c *Comment) Authority() core.Principal {
	if len(c.Account) == 0 {
		return c.Signer
	}

	return c.Account
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

// commentVersionHashAttr is the extra_attrs key holding commentVersionHash.
const commentVersionHashAttr = "hash"

// commentVersionHash returns the first 8 bytes of a comment version's hash digest
// as lowercase hex. Versions of one comment that share a timestamp are ordered by
// it, which every replica computes the same way. Hex compares as text in the same
// order as the bytes, so queries order by it directly from the index.
func commentVersionHash(c cid.Cid) (string, error) {
	dmh, err := multihash.Decode(c.Hash())
	if err != nil {
		return "", fmt.Errorf("invalid comment CID %s: %w", c, err)
	}

	if len(dmh.Digest) < 8 {
		return "", fmt.Errorf("comment CID %s has a digest shorter than 8 bytes", c)
	}

	return hex.EncodeToString(dmh.Digest[:8]), nil
}

// errCommentNoVersion rejects a comment that pins no version of its target
// document. Such a comment identifies no document, so it is bad data.
var errCommentNoVersion = errors.New("comment must pin a version of its target document")

func indexComment(ictx *indexingCtx, id int64, eb Encoded[*Comment]) error {
	c, v := eb.CID, eb.Decoded

	if len(v.Version) == 0 {
		return stashError{
			Reason:   stashReasonBadData,
			Metadata: stashMetadata{Details: errCommentNoVersion.Error()},
		}
	}

	authority := v.Authority()
	if len(v.Account) != 0 {
		account, err := core.DecodePrincipal([]byte(v.Account))
		if err != nil {
			return fmt.Errorf("invalid comment account: %w", err)
		}

		v.Account = account
		authority = account

		// Redundant self-account encodings are direct signatures, not delegation.
		if !account.Equal(v.Signer) {
			accountID, err := ictx.ensurePubKey(account)
			if err != nil {
				return err
			}

			signerID, err := ictx.ensurePubKey(v.Signer)
			if err != nil {
				return err
			}

			valid, err := isValidAgentKey(ictx.conn, accountID, signerID)
			if err != nil {
				return err
			}

			if !valid {
				return stashError{
					Reason:   stashReasonPermissionDenied,
					Metadata: stashMetadata{DeniedSigners: []core.Principal{v.Signer}},
				}
			}
		}
	}

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

	if !authority.Equal(v.Signer) {
		_, accountID, err := ictx.ensureAccount(authority)
		if err != nil {
			return err
		}

		// Author remains the signer for implicit capability discovery. Account
		// supplies the stable comment identity across delegated key rotations.
		extraAttrs["account"] = accountID
	}

	// Comments have an explicit visibility field, which is usually inherited from the document they target.
	// For private comments, they're owned by both the account authority and the target document's space.
	var visibilitySpaces []core.Principal
	if v.Visibility == VisibilityPrivate {
		visibilitySpaces = []core.Principal{authority}
		// Also include the target space to allow the space owner to access comments on their documents.
		if !authority.Equal(v.Space()) {
			visibilitySpaces = append(visibilitySpaces, v.Space())
		}
	}
	sb := newStructuralBlob(c, v.Type, v.Signer, v.Ts, iri, cid.Undef, v.Space(), time.Time{}, v.Visibility, visibilitySpaces)
	sb.ExtraAttrs = extraAttrs

	if v.Visibility != VisibilityPublic {
		extraAttrs["visibility"] = v.Visibility
	}

	extraAttrs["tsid"] = eb.TSID()

	hash, err := commentVersionHash(c)
	if err != nil {
		return err
	}

	extraAttrs[commentVersionHashAttr] = hash

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
	if err := reindexStashedBlobs(ictx.childOpts(), ictx.conn, stashReasonFailedPrecondition, c.String(), ictx.blockStore, ictx.log, ictx.batch, ictx.hookIDs); err != nil {
		return err
	}

	if err := settleComment(ictx, id, eb); err != nil {
		return err
	}

	if ictx.mustTrackUnreads {
		if err := ensureUnread(ictx.conn, iri); err != nil {
			return err
		}
	}

	return nil
}

// settleComment resolves the document that comment version id targets and
// recomputes which version of its comment is live. The comment stats of every
// document and space that changes are recounted when the batch flushes.
// Target changes that aren't indexed yet, whether stored or not, return a stash
// error: like a Ref, the comment waits until every change it names arrives.
func settleComment(ictx *indexingCtx, id int64, eb Encoded[*Comment]) error {
	c, v := eb.CID, eb.Decoded

	var (
		genesisBlobID  int64
		pendingChanges []cid.Cid
	)
	for _, ver := range v.Version {
		change, err := ictx.indexedChange(ver)
		if err != nil {
			return err
		}

		if change.ID == 0 {
			pendingChanges = append(pendingChanges, ver)
			continue
		}

		// A version names heads of one document: Changes with one genesis.
		// Anything else doesn't identify a document, so the comment is invalid.
		if !change.IsChange || (genesisBlobID != 0 && genesisBlobID != change.Genesis) {
			return stashError{
				Reason: stashReasonBadData,
				Metadata: stashMetadata{
					Details: fmt.Sprintf("comment target version %s doesn't name Changes of one document", NewVersion(v.Version...)),
				},
			}
		}

		genesisBlobID = change.Genesis
	}

	if pendingChanges != nil {
		return stashError{
			Reason:   stashReasonFailedPrecondition,
			Metadata: stashMetadata{MissingBlobs: pendingChanges},
		}
	}

	genesis, err := lookupBlobCID(ictx.conn, genesisBlobID)
	if err != nil {
		return fmt.Errorf("failed to resolve target genesis for comment %s: %w", c, err)
	}

	affected, err := updateCommentLive(ictx.conn, v.Authority(), eb.TSID(), id, genesis)
	if err != nil {
		return err
	}

	// Stats are recounted once per batch, when it flushes: recounting per
	// comment is quadratic in a document's or a space's comments.
	ictx.batch.markCommentStats(affected)

	return nil
}
