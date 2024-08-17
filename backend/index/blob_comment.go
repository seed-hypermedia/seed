package index

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
	cbornode.RegisterCborType(Block{})
	cbornode.RegisterCborType(Annotation{})
	cbornode.RegisterCborType(CommentBlock{})
	cbornode.RegisterCborType(CommentTarget{})
}

type Comment struct {
	CommentUnsigned
	Sig core.Signature `refmt:"sig,omitempty"`
}

func NewComment(kp core.KeyPair, cpb cid.Cid, t CommentTarget, threadRoot, replyParent cid.Cid, body []CommentBlock, ts int64) (eb EncodedBlob[*Comment], err error) {
	cu := CommentUnsigned{
		Type:        blobTypeComment,
		Capability:  cpb,
		Author:      kp.Principal(),
		Target:      t,
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

type CommentUnsigned struct {
	Type        blobType       `refmt:"@type"`
	Capability  cid.Cid        `refmt:"capability,omitempty"`
	Author      core.Principal `refmt:"author"`
	Target      CommentTarget  `refmt:"target"`
	ThreadRoot  cid.Cid        `refmt:"threadRoot,omitempty"`
	ReplyParent cid.Cid        `refmt:"replyParent,omitempty"`
	Body        []CommentBlock `refmt:"body"`
	Ts          int64          `refmt:"ts"`
}

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

type CommentTarget struct {
	Account core.Principal `refmt:"account"`
	Path    string         `refmt:"path,omitempty"`
	Version []cid.Cid      `refmt:"version,omitempty"`
}

// Block is a block of text with annotations.
type Block struct {
	ID          string            `refmt:"id,omitempty"` // Omitempty when used in Documents.
	Type        string            `refmt:"type,omitempty"`
	Text        string            `refmt:"text,omitempty"`
	Ref         string            `refmt:"ref,omitempty"`
	Attributes  map[string]string `refmt:"attributes,omitempty"`
	Annotations []Annotation      `refmt:"annotations,omitempty"`
}

// Annotation is a range of text that has a type and attributes.
type Annotation struct {
	Type       string            `refmt:"type"`
	Ref        string            `refmt:"ref,omitempty"`
	Attributes map[string]string `refmt:"attributes,omitempty"`
	Starts     []int32           `refmt:"starts,omitempty"`
	Ends       []int32           `refmt:"ends,omitempty"`
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
	riri, err := NewIRI(v.Target.Account, v.Target.Path)
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

	sb := newStructuralBlob(c, string(v.Type), v.Author, time.UnixMicro(v.Ts), riri, cid.Undef, v.Target.Account, time.Time{})

	targetURI, err := url.Parse(string(riri))
	if err != nil {
		return err
	}

	targetVersion := NewVersion(v.Target.Version...)
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
			if err := indexURL(&sb, ictx.log, blk.ID, "comment/"+blk.Type, blk.Ref); err != nil {
				return err
			}

			for _, a := range blk.Annotations {
				if err := indexURL(&sb, ictx.log, blk.ID, "comment/"+a.Type, a.Ref); err != nil {
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
