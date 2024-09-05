package documents

import (
	"context"
	"errors"
	"fmt"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/hlc"
	"seed/backend/index"
	"seed/backend/util/errutil"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateComment implements Comments API.
func (srv *Server) CreateComment(ctx context.Context, in *documents.CreateCommentRequest) (*documents.Comment, error) {
	if in.SigningKeyName == "" {
		return nil, errutil.MissingArgument("signing_key")
	}

	if in.Capability != "" {
		return nil, status.Errorf(codes.Unimplemented, "TODO: comments with capabilities are not supported yet")
	}

	if in.TargetVersion == "" {
		return nil, errutil.MissingArgument("target_version")
	}

	versionHeads, err := index.Version(in.TargetVersion).Parse()
	if err != nil {
		return nil, err
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	acc, err := core.DecodePrincipal(in.TargetAccount)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse target account: %v", err)
	}

	clock := hlc.NewClock()

	var (
		threadRoot  cid.Cid
		replyParent cid.Cid
	)
	if in.ReplyParent != "" {
		replyParent, err = cid.Decode(in.ReplyParent)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to parse reply parent CID %s: %v", in.ReplyParent, err)
		}

		rpdata, err := srv.idx.Get(ctx, replyParent)
		if err != nil {
			return nil, fmt.Errorf("reply parent %s not found: %w", in.ReplyParent, err)
		}

		rp := &index.Comment{}
		if err := cbornode.DecodeInto(rpdata.RawData(), rp); err != nil {
			return nil, fmt.Errorf("failed to decode reply parent %s: %w", in.ReplyParent, err)
		}

		threadRoot = rp.ThreadRoot
		if !threadRoot.Defined() {
			threadRoot = replyParent
		}

		if err := clock.Track(hlc.Timestamp(rp.Ts)); err != nil {
			return nil, err
		}

		if threadRoot.Equals(replyParent) {
			replyParent = cid.Undef
		}
	}

	target := index.CommentTarget{
		Account: acc,
		Path:    in.TargetPath,
		Version: versionHeads,
	}

	blob, err := index.NewComment(kp, cid.Undef, target, threadRoot, replyParent, commentContentFromProto(in.Content), int64(clock.MustNow()))
	if err != nil {
		return nil, err
	}

	if err := srv.idx.Put(ctx, blob); err != nil {
		return nil, err
	}

	return srv.GetComment(ctx, &documents.GetCommentRequest{Id: blob.CID.String()})
}

// GetComment implements Comments API.
func (srv *Server) GetComment(ctx context.Context, in *documents.GetCommentRequest) (*documents.Comment, error) {
	c, err := cid.Decode(in.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse comment ID %s as CID: %v", in.Id, err)
	}

	blk, err := srv.idx.Get(ctx, c)
	if err != nil {
		return nil, err
	}

	cp := &index.Comment{}
	if err := cbornode.DecodeInto(blk.RawData(), cp); err != nil {
		return nil, err
	}

	return commentToProto(c, cp)
}

// ListComments implements Comments API.
func (srv *Server) ListComments(ctx context.Context, in *documents.ListCommentsRequest) (*documents.ListCommentsResponse, error) {
	acc, err := core.DecodePrincipal(in.TargetAccount)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse target account '%s': %v", in.TargetAccount, err)
	}

	iri, err := index.NewIRI(acc, in.TargetPath)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse target path '%s': %v", in.TargetPath, err)
	}

	// TODO(burdiyan): implement pagination.
	resp := &documents.ListCommentsResponse{}

	var outErr error
	comments, check := srv.idx.IterComments(ctx, iri)
	for c, cp := range comments {
		pb, err := commentToProto(c, cp)
		if err != nil {
			outErr = err
			break
		}
		resp.Comments = append(resp.Comments, pb)
	}
	outErr = errors.Join(outErr, check())
	if outErr != nil {
		return nil, outErr
	}

	return resp, nil
}

func commentToProto(c cid.Cid, cmt *index.Comment) (*documents.Comment, error) {
	pb := &documents.Comment{
		Id:            c.String(),
		TargetAccount: cmt.Target.Account.String(),
		TargetPath:    cmt.Target.Path,
		TargetVersion: docmodel.NewVersion(cmt.Target.Version...).String(),
		Author:        cmt.Author.String(),
		Content:       commentContentToProto(cmt.Body),
		CreateTime:    timestamppb.New(time.UnixMicro(cmt.Ts)),
	}

	if cmt.ReplyParent.Defined() {
		pb.ReplyParent = cmt.ReplyParent.String()
	}

	if cmt.ThreadRoot.Defined() {
		pb.ThreadRoot = cmt.ThreadRoot.String()
	}

	if pb.ThreadRoot != "" && pb.ReplyParent == "" {
		pb.ReplyParent = pb.ThreadRoot
	}

	return pb, nil
}

func commentContentToProto(in []index.CommentBlock) []*documents.BlockNode {
	if in == nil {
		return nil
	}

	out := make([]*documents.BlockNode, len(in))
	for i, b := range in {
		out[i] = &documents.BlockNode{
			Block: &documents.Block{
				Id:          b.ID,
				Type:        b.Type,
				Text:        b.Text,
				Ref:         b.Ref,
				Attributes:  b.Attributes,
				Annotations: annotationsToProto(b.Annotations),
			},
			Children: commentContentToProto(b.Children),
		}
	}

	return out
}

func annotationsToProto(in []index.Annotation) []*documents.Annotation {
	if in == nil {
		return nil
	}

	out := make([]*documents.Annotation, len(in))
	for i, a := range in {
		out[i] = &documents.Annotation{
			Type:       a.Type,
			Ref:        a.Ref,
			Attributes: a.Attributes,
			Starts:     a.Starts,
			Ends:       a.Ends,
		}
	}

	return out
}

func commentContentFromProto(in []*documents.BlockNode) []index.CommentBlock {
	if in == nil {
		return nil
	}

	out := make([]index.CommentBlock, len(in))

	for i, n := range in {
		out[i] = index.CommentBlock{
			Block: index.Block{
				ID:          n.Block.Id,
				Type:        n.Block.Type,
				Text:        n.Block.Text,
				Ref:         n.Block.Ref,
				Attributes:  n.Block.Attributes,
				Annotations: annotationsFromProto(n.Block.Annotations),
			},
			Children: commentContentFromProto(n.Children),
		}
	}

	return out
}

func annotationsFromProto(in []*documents.Annotation) []index.Annotation {
	if in == nil {
		return nil
	}

	out := make([]index.Annotation, len(in))
	for i, a := range in {
		out[i] = index.Annotation{
			Type:       a.Type,
			Ref:        a.Ref,
			Attributes: a.Attributes,
			Starts:     a.Starts,
			Ends:       a.Ends,
		}
	}

	return out
}
