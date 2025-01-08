package documents

import (
	"context"
	"errors"
	"fmt"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/errutil"
	"seed/backend/util/must"

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

	versionHeads, err := blob.Version(in.TargetVersion).Parse()
	if err != nil {
		return nil, err
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	space, err := core.DecodePrincipal(in.TargetAccount)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse target account: %v", err)
	}

	clock := cclock.New()

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

		rp := &blob.Comment{}
		if err := cbornode.DecodeInto(rpdata.RawData(), rp); err != nil {
			return nil, fmt.Errorf("failed to decode reply parent %s: %w", in.ReplyParent, err)
		}

		threadRoot = rp.ThreadRoot
		if !threadRoot.Defined() {
			threadRoot = replyParent
		}

		if err := clock.Track(rp.Ts); err != nil {
			return nil, err
		}

		if threadRoot.Equals(replyParent) {
			replyParent = cid.Undef
		}
	}

	blob, err := blob.NewComment(kp, cid.Undef, space, in.TargetPath, versionHeads, threadRoot, replyParent, commentContentFromProto(in.Content), clock.MustNow())
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

	cp := &blob.Comment{}
	if err := cbornode.DecodeInto(blk.RawData(), cp); err != nil {
		return nil, err
	}

	return commentToProto(c, cp)
}

// BatchGetComments implements Comments API.
func (srv *Server) BatchGetComments(ctx context.Context, in *documents.BatchGetCommentsRequest) (*documents.BatchGetCommentsResponse, error) {
	cc := make([]cid.Cid, len(in.Ids))

	for i, id := range in.Ids {
		c, err := cid.Decode(id)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to parse comment ID %s as CID: %v", id, err)
		}
		cc[i] = c
	}

	blocks, err := srv.idx.GetMany(ctx, cc)
	if err != nil {
		return nil, err
	}

	resp := &documents.BatchGetCommentsResponse{
		Comments: make([]*documents.Comment, len(blocks)),
	}

	for i, blk := range blocks {
		cp := &blob.Comment{}
		if err := cbornode.DecodeInto(blk.RawData(), cp); err != nil {
			return nil, err
		}

		pb, err := commentToProto(cc[i], cp)
		if err != nil {
			return nil, err
		}

		resp.Comments[i] = pb
	}

	return resp, nil
}

// ListComments implements Comments API.
func (srv *Server) ListComments(ctx context.Context, in *documents.ListCommentsRequest) (*documents.ListCommentsResponse, error) {
	acc, err := core.DecodePrincipal(in.TargetAccount)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse target account '%s': %v", in.TargetAccount, err)
	}

	iri, err := blob.NewIRI(acc, in.TargetPath)
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

func commentToProto(c cid.Cid, cmt *blob.Comment) (*documents.Comment, error) {
	content, err := commentContentToProto(cmt.Body)
	if err != nil {
		return nil, err
	}

	pb := &documents.Comment{
		Id:            c.String(),
		TargetAccount: cmt.GetSpace().String(),
		TargetPath:    cmt.Path,
		TargetVersion: docmodel.NewVersion(cmt.Version...).String(),
		Author:        cmt.Signer.String(),
		Content:       content,
		CreateTime:    timestamppb.New(cmt.Ts),
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

func commentContentToProto(in []blob.CommentBlock) ([]*documents.BlockNode, error) {
	if in == nil {
		return nil, nil
	}

	out := make([]*documents.BlockNode, len(in))
	for i, b := range in {
		blockpb, err := docmodel.BlockToProto(b.Block, cid.Undef)
		if err != nil {
			return nil, err
		}

		children, err := commentContentToProto(b.Children)
		if err != nil {
			return nil, err
		}

		out[i] = &documents.BlockNode{
			Block:    blockpb,
			Children: children,
		}
	}

	return out, nil
}

func commentContentFromProto(in []*documents.BlockNode) []blob.CommentBlock {
	if in == nil {
		return nil
	}

	out := make([]blob.CommentBlock, len(in))

	for i, n := range in {
		out[i] = blob.CommentBlock{
			Block:    must.Do2(docmodel.BlockFromProto(n.Block)),
			Children: commentContentFromProto(n.Children),
		}
	}

	return out
}
