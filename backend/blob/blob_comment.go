package blob

import (
	"bytes"
	"fmt"
	"net/url"
	"seed/backend/core"
	"seed/backend/ipfs"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/multiformats/go-multicodec"
)

const blobTypeComment blobType = "Comment"

func init() {
	cbornode.RegisterCborType(Comment{})
	cbornode.RegisterCborType(CommentUnsigned{})
	cbornode.RegisterCborType(CommentBlock{})
}

// Comment is a blob that represents a comment to some document, or a reply to some other comment.
type Comment struct {
	CommentUnsigned
	Sig core.Signature `refmt:"sig,omitempty"`
}

// NewComment creates a new Comment blob.
func NewComment(
	kp core.KeyPair,
	cpb cid.Cid,
	space core.Principal,
	path string,
	version []cid.Cid,
	threadRoot cid.Cid,
	replyParent cid.Cid,
	body []CommentBlock,
	ts time.Time,
) (eb Encoded[*Comment], err error) {
	cu := CommentUnsigned{
		Type:        blobTypeComment,
		Capability:  cpb,
		Author:      kp.Principal(),
		Space:       space,
		Path:        path,
		Version:     version,
		ThreadRoot:  threadRoot,
		ReplyParent: replyParent,
		Body:        body,
		Ts:          ts,
	}

	cc, err := cu.Sign(kp)
	if err != nil {
		return eb, err
	}

	return encodeBlob(cc)
}

// CommentUnsigned holds the fields of a Comment that are meant to be signed.
type CommentUnsigned struct {
	Type        blobType       `refmt:"type"`
	Capability  cid.Cid        `refmt:"capability,omitempty"`
	Author      core.Principal `refmt:"author"`
	Space       core.Principal `refmt:"space"`
	Path        string         `refmt:"path,omitempty"`
	Version     []cid.Cid      `refmt:"version,omitempty"`
	ThreadRoot  cid.Cid        `refmt:"threadRoot,omitempty"`
	ReplyParent cid.Cid        `refmt:"replyParent,omitempty"`
	Body        []CommentBlock `refmt:"body"`
	Ts          time.Time      `refmt:"ts"`
}

// Sign signs the CommentUnsigned with the given keypair.
func (r *CommentUnsigned) Sign(kp core.KeyPair) (rr *Comment, err error) {
	if !r.Author.Equal(kp.Principal()) {
		return nil, fmt.Errorf("author mismatch when signing")
	}

	data, err := cbornode.DumpObject(r)
	if err != nil {
		return nil, err
	}

	sig, err := kp.Sign(data)
	if err != nil {
		return nil, err
	}

	return &Comment{
		CommentUnsigned: *r,
		Sig:             sig,
	}, nil
}

// CommentBlock is a block of text with annotations.
type CommentBlock struct {
	Block

	Children []CommentBlock `refmt:"children,omitempty"`
}

func init() {
	matcher := makeCBORTypeMatch(blobTypeComment)

	registerIndexer(blobTypeComment,
		func(c cid.Cid, data []byte) (*Comment, error) {
			codec, _ := ipfs.DecodeCID(c)
			if codec != multicodec.DagCbor || !bytes.Contains(data, matcher) {
				return nil, errSkipIndexing
			}

			v := &Comment{}
			if err := cbornode.DecodeInto(data, v); err != nil {
				return nil, err
			}

			return v, nil
		},
		indexComment,
	)
}

func indexComment(ictx *indexingCtx, id int64, c cid.Cid, v *Comment) error {
	riri, err := NewIRI(v.Space, v.Path)
	if err != nil {
		return fmt.Errorf("invalid comment target: %v", err)
	}

	// TODO: ignore comments for removed target resources.

	threadRoot := v.ThreadRoot
	replyParent := v.ReplyParent

	if replyParent.Defined() && !threadRoot.Defined() {
		return fmt.Errorf("comments with replyParent must have threadRoot")
	}

	if threadRoot.Defined() && !replyParent.Defined() {
		replyParent = threadRoot
	}

	isReply := threadRoot.Defined() && replyParent.Defined()

	if isReply {
		_ = isReply
		// TODO: validate reply comments!
		// Something still happens during syncing that we don't have proper causal delivery. Need to fix that.
		// Validation rules:
		// - Reply Parent and Thread Root must have been indexed.
		// - Reply Parent and this comment must have the same target Account + Path.
		// - Reply Parent and this comment must have the same Thread Root.
		// - This comment must have a timestamp greater than any other predecessor comment.
	}

	sb := newStructuralBlob(c, string(v.Type), v.Author, v.Ts, riri, cid.Undef, v.Space, time.Time{})

	targetURI, err := url.Parse(string(riri))
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

	var indexCommentContent func([]CommentBlock) error // Declaring function to allow recursive calls.
	indexCommentContent = func(in []CommentBlock) error {
		for _, blk := range in {
			if err := indexURL(&sb, ictx.log, blk.ID, "comment/"+blk.Type, blk.Link); err != nil {
				return err
			}

			for _, a := range blk.Annotations {
				if err := indexURL(&sb, ictx.log, blk.ID, "comment/"+a.Type, a.Link); err != nil {
					return err
				}
			}

			if err := indexCommentContent(blk.Children); err != nil {
				return err
			}
		}

		return nil
	}

	if err := indexCommentContent(v.Body); err != nil {
		return err
	}

	return ictx.SaveBlob(id, sb)
}
