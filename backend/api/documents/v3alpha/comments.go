package documents

import (
	"context"
	"fmt"
	"math"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/ipfs"
	"seed/backend/util/apiutil"
	"seed/backend/util/cclock"
	"seed/backend/util/dqb"
	"seed/backend/util/errutil"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateComment implements Comments API.
func (srv *Server) CreateComment(ctx context.Context, in *documents.CreateCommentRequest) (out *documents.Comment, err error) {
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
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			rpComment, err := srv.getComment(conn, in.ReplyParent)
			if err != nil {
				return fmt.Errorf("reply parent not found: %w", err)
			}

			replyParent = rpComment.CID
			threadRoot = rpComment.Comment.ThreadRoot
			if !threadRoot.Defined() {
				threadRoot = replyParent
			}

			if err := clock.Track(rpComment.Comment.Ts); err != nil {
				return err
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}

	eb, err := blob.NewComment(kp, "", space, in.TargetPath, versionHeads, threadRoot, replyParent, commentContentFromProto(in.Content), clock.MustNow())
	if err != nil {
		return nil, err
	}

	if err := srv.idx.Put(ctx, eb); err != nil {
		return nil, err
	}

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (*documents.Comment, error) {
		lookup := blob.NewLookupCache(conn)
		return commentToProto(lookup, eb.CID, eb.Decoded, eb.TSID())
	})
}

// GetComment implements Comments API.
func (srv *Server) GetComment(ctx context.Context, in *documents.GetCommentRequest) (*documents.Comment, error) {
	resp, err := srv.BatchGetComments(ctx, &documents.BatchGetCommentsRequest{
		Ids: []string{in.Id},
	})
	if err != nil {
		return nil, err
	}

	return resp.Comments[0], nil
}

// BatchGetComments implements Comments API.
func (srv *Server) BatchGetComments(ctx context.Context, in *documents.BatchGetCommentsRequest) (out *documents.BatchGetCommentsResponse, err error) {
	resp := &documents.BatchGetCommentsResponse{
		Comments: make([]*documents.Comment, len(in.Ids)),
	}

	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		lookup := blob.NewLookupCache(conn)
		for i, id := range in.Ids {
			icmt, err := srv.getComment(conn, id)
			if err != nil {
				return err
			}

			pb, err := commentToProto(lookup, icmt.CID, icmt.Comment, icmt.TSID)
			if err != nil {
				return err
			}

			resp.Comments[i] = pb
		}
		return nil
	}); err != nil {
		return nil, err
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

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (resp *documents.ListCommentsResponse, err error) {
		resp = &documents.ListCommentsResponse{}
		mapper := srv.commentDBMapper()
		lookup := blob.NewLookupCache(conn)

		comments, discard, check := sqlitex.QueryType(conn, mapper.HandleRow, qIterComments(), iri)
		defer discard(&err)
		for comment := range comments {
			// Checking error from the mapper in case there's something wrong in the decoding from the database.
			if err := mapper.Err(); err != nil {
				return nil, err
			}

			pb, err := commentToProto(lookup, comment.CID, comment.Comment, comment.TSID)
			if err != nil {
				return nil, err
			}

			resp.Comments = append(resp.Comments, pb)
		}
		return resp, check()
	})
}

// ListCommentsByAuthor implements Comments API.
func (srv *Server) ListCommentsByAuthor(ctx context.Context, in *documents.ListCommentsByAuthorRequest) (*documents.ListCommentsResponse, error) {
	author, err := core.DecodePrincipal(in.Author)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse author '%s': %v", in.Author, err)
	}

	if in.PageSize == 0 {
		in.PageSize = defaultPageSize
	}

	var cursor struct {
		CommentID int64 `json:"c_id"`
	}

	cursor.CommentID = math.MaxInt64

	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &cursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (resp *documents.ListCommentsResponse, err error) {
		resp = &documents.ListCommentsResponse{
			Comments: make([]*documents.Comment, 0, min(in.PageSize, maxPageAllocBuffer)),
		}

		mapper := srv.commentDBMapper()
		lookup := blob.NewLookupCache(conn)

		comments, discard, check := sqlitex.QueryType(conn, mapper.HandleRow, qIterCommentsByAuthor(), author, cursor.CommentID, in.PageSize+1)
		defer discard(&err)

		for result := range comments {
			if len(resp.Comments) == int(in.PageSize) {
				resp.NextPageToken = apiutil.EncodePageToken(cursor, nil)
				break
			}

			pb, err := commentToProto(lookup, result.CID, result.Comment, result.TSID)
			if err != nil {
				return nil, err
			}

			resp.Comments = append(resp.Comments, pb)
			cursor.CommentID = result.DBID
		}

		return resp, check()
	})
}

type indexedComment struct {
	DBID    int64
	CID     cid.Cid
	TSID    blob.TSID
	Comment *blob.Comment
}

type commentDBMapper struct {
	srv *Server
	err error
	buf []byte
}

func (m *commentDBMapper) HandleRow(stmt *sqlite.Stmt) indexedComment {
	seq := sqlite.NewIncrementor(0)
	var (
		id    = stmt.ColumnInt64(seq())
		codec = stmt.ColumnInt64(seq())
		hash  = stmt.ColumnBytesUnsafe(seq())
		data  = stmt.ColumnBytesUnsafe(seq())
		tsid  = stmt.ColumnText(seq())
	)

	// Reset the buffer before decoding.
	m.buf = m.buf[:0]

	m.buf, m.err = m.srv.idx.Decompress(data, m.buf)
	if m.err != nil {
		return indexedComment{}
	}

	c := cid.NewCidV1(uint64(codec), hash)
	cmt := &blob.Comment{}
	m.err = cbornode.DecodeInto(m.buf, cmt)
	if m.err != nil {
		return indexedComment{}
	}

	return indexedComment{
		DBID:    id,
		CID:     c,
		TSID:    blob.TSID(tsid),
		Comment: cmt,
	}
}

func (m *commentDBMapper) Err() error {
	return m.err
}

func (srv *Server) commentDBMapper() *commentDBMapper {
	return &commentDBMapper{
		srv: srv,
		buf: make([]byte, 0, 1024*1024),
	}
}

var qIterComments = dqb.Str(`
	SELECT
		sb.id,
        b.codec,
		b.multihash,
		b.data,
		sb.extra_attrs->>'tsid' AS tsid
	FROM (
		SELECT
        	sb.*,
         	ROW_NUMBER() OVER (PARTITION BY sb.extra_attrs->>'tsid' ORDER BY sb.ts DESC) rn
        FROM structural_blobs sb
  		WHERE sb.type = 'Comment'
    	AND sb.resource = (SELECT id FROM resources WHERE iri = :iri)
	) sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.rn = 1
	AND sb.extra_attrs->>'deleted' IS NULL
	ORDER BY sb.ts
`)

var qIterCommentsByAuthor = dqb.Str(`
	SELECT
		sb.id,
		b.codec,
		b.multihash,
		b.data,
		sb.extra_attrs->>'tsid' AS tsid
	FROM (
        SELECT
        	sb.*,
         	ROW_NUMBER() OVER (PARTITION BY sb.extra_attrs->>'tsid' ORDER BY sb.ts DESC) rn
        FROM structural_blobs sb
  		WHERE sb.type = 'Comment'
    	AND sb.author = (SELECT id FROM public_keys WHERE principal = :author)
	) sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.rn = 1
	AND sb.extra_attrs->>'deleted' IS NULL
	AND sb.id < :afterID
	ORDER BY sb.id DESC
	LIMIT :limit
`)

func (srv *Server) getComment(conn *sqlite.Conn, idRaw string) (out indexedComment, err error) {
	var (
		query string
		args  []any
	)
	{
		rid, err := blob.DecodeRecordID(idRaw)
		if err != nil {
			// We allow to get comment by RecordID or CID.
			c, cerr := cid.Decode(idRaw)
			if cerr != nil {
				return indexedComment{}, status.Errorf(codes.InvalidArgument, "failed to parse comment ID %s: %v: %v", idRaw, err, cerr)
			}
			query = qGetCommentByCID()
			codec, hash := ipfs.DecodeCID(c)
			args = []any{codec, hash}
		} else {
			query = qGetCommentByID()
			args = []any{rid.Authority, rid.TSID.String()}
		}
	}

	mapper := srv.commentDBMapper()
	comments, discard, check := sqlitex.QueryType(conn, mapper.HandleRow, query, args...)
	defer discard(&err)

	var icmt indexedComment
	for cmt := range comments {
		// Check if the comment is marked as deleted
		if len(cmt.Comment.Body) == 0 {
			return out, status.Errorf(codes.NotFound, "comment %s has been deleted", idRaw)
		}
		icmt = cmt
		break
	}
	if err := check(); err != nil {
		return out, err
	}

	if icmt.Comment == nil {
		return indexedComment{}, status.Errorf(codes.NotFound, "comment %s not found", idRaw)
	}

	return icmt, nil
}

var qGetCommentByID = dqb.Str(`
	SELECT
		sb.id,
		b.codec,
		b.multihash,
		b.data,
		sb.extra_attrs->>'tsid' AS tsid
	FROM structural_blobs sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.type = 'Comment'
	AND sb.author = (SELECT id FROM public_keys WHERE principal = :authority)
	AND sb.extra_attrs->>'tsid' = :tsid
	ORDER BY sb.ts DESC
	LIMIT 1
`)

var qGetCommentByCID = dqb.Str(`
	SELECT
		sb.id,
		codec,
		multihash,
		data,
		sb.extra_attrs->>'tsid' AS tsid
	FROM blobs
	JOIN structural_blobs sb ON sb.id = blobs.id
	WHERE (codec, multihash) = (:codec, :multihash)
`)

var qGetReplyCountByID = dqb.Str(`
SELECT count(distinct source)
FROM  blob_links bl
WHERE bl.target = (
   SELECT id
   FROM structural_blobs sb
   WHERE sb.type = 'Comment'
   AND sb.extra_attrs->>'deleted' is not true
   AND sb.author = (SELECT id FROM public_keys WHERE principal = :authority)
   AND sb.extra_attrs->>'tsid' = :tsid
)
AND bl.type IN ('comment/reply-parent', 'comment/thread-root')
AND (SELECT sb.extra_attrs->>'deleted' FROM structural_blobs sb WHERE id = source) is not true
`)

func commentToProto(lookup *blob.LookupCache, c cid.Cid, cmt *blob.Comment, tsid blob.TSID) (*documents.Comment, error) {
	var content []*documents.BlockNode
	var err error
	if cmt.Body != nil {
		content, err = commentContentToProto(cmt.Body)
		if err != nil {
			return nil, err
		}
	}

	createTime := tsid.Timestamp()

	pb := &documents.Comment{
		Id:            blob.RecordID{Authority: cmt.Signer, TSID: tsid}.String(),
		TargetAccount: cmt.Space().String(),
		TargetPath:    cmt.Path,
		TargetVersion: docmodel.NewVersion(cmt.Version...).String(),
		Author:        cmt.Signer.String(),
		Content:       content,
		CreateTime:    timestamppb.New(createTime),
		Version:       c.String(),
		UpdateTime:    timestamppb.New(cmt.Ts),
	}

	// Handle deleted attribute
	if len(content) == 0 {
		pb.Content = nil
	}

	if cmt.ThreadRoot.Defined() {
		ridRoot, err := lookup.RecordID(cmt.ThreadRoot)
		if err != nil {
			return nil, err
		}

		ridParent, err := lookup.RecordID(cmt.ReplyParent())
		if err != nil {
			return nil, err
		}

		pb.ThreadRoot = ridRoot.String()
		pb.ThreadRootVersion = cmt.ThreadRoot.String()
		pb.ReplyParent = ridParent.String()
		pb.ReplyParentVersion = cmt.ReplyParent().String()

		if pb.ReplyParent == "" {
			panic("BUG: reply parent must not be empty in relies")
		}
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

// UpdateComment implements Comments API.
func (srv *Server) UpdateComment(ctx context.Context, in *documents.UpdateCommentRequest) (*documents.Comment, error) {
	if in.Comment == nil {
		return nil, status.Errorf(codes.InvalidArgument, "comment is required")
	}

	if in.SigningKeyName == "" {
		return nil, status.Errorf(codes.InvalidArgument, "signing_key_name is required")
	}

	comment := in.Comment
	if comment.Id == "" {
		return nil, status.Errorf(codes.InvalidArgument, "comment.id is required")
	}

	if comment.TargetAccount == "" {
		return nil, status.Errorf(codes.InvalidArgument, "comment.target_account is required")
	}

	if comment.TargetVersion == "" {
		return nil, status.Errorf(codes.InvalidArgument, "comment.target_version is required")
	}

	if len(comment.Content) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "comment.content is required")
	}

	rid, err := blob.DecodeRecordID(comment.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode comment ID: %v", err)
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	if !kp.Principal().Equal(rid.Authority) {
		return nil, status.Errorf(codes.PermissionDenied, "only the original author can update a comment")
	}

	space, err := core.DecodePrincipal(comment.TargetAccount)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse target account: %v", err)
	}

	versionHeads, err := blob.Version(comment.TargetVersion).Parse()
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse target version: %v", err)
	}

	clock := cclock.New()

	var (
		threadRoot  cid.Cid
		replyParent cid.Cid
	)

	if comment.ReplyParent != "" {
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			rpComment, err := srv.getComment(conn, comment.ReplyParent)
			if err != nil {
				return fmt.Errorf("reply parent %s not found: %w", comment.ReplyParent, err)
			}

			replyParent = rpComment.CID
			threadRoot = rpComment.Comment.ThreadRoot
			if !threadRoot.Defined() {
				threadRoot = replyParent
			}

			if err := clock.Track(rpComment.Comment.Ts); err != nil {
				return err
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}

	eb, err := blob.NewComment(kp, rid.TSID, space, comment.TargetPath, versionHeads, threadRoot, replyParent, commentContentFromProto(comment.Content), clock.MustNow())
	if err != nil {
		return nil, err
	}

	if err := srv.idx.Put(ctx, eb); err != nil {
		return nil, err
	}

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (*documents.Comment, error) {
		lookup := blob.NewLookupCache(conn)
		return commentToProto(lookup, eb.CID, eb.Decoded, eb.TSID())
	})
}

// DeleteComment implements Comments API.
func (srv *Server) DeleteComment(ctx context.Context, in *documents.DeleteCommentRequest) (*emptypb.Empty, error) {
	if in.Id == "" {
		return nil, status.Errorf(codes.InvalidArgument, "id is required")
	}

	if in.SigningKeyName == "" {
		return nil, status.Errorf(codes.InvalidArgument, "signing_key_name is required")
	}

	rid, err := blob.DecodeRecordID(in.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode comment ID: %v", err)
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	if !kp.Principal().Equal(rid.Authority) {
		return nil, status.Errorf(codes.PermissionDenied, "signing key must match the comment author")
	}

	var originalComment indexedComment
	clock := cclock.New()

	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		var err error
		originalComment, err = srv.getComment(conn, in.Id)
		if err != nil {
			return err
		}
		return clock.Track(originalComment.Comment.Ts)
	}); err != nil {
		return nil, err
	}

	if !originalComment.Comment.Signer.Equal(kp.Principal()) {
		return nil, status.Errorf(codes.PermissionDenied, "only the original author can delete a comment")
	}

	eb, err := blob.NewComment(kp, rid.TSID, originalComment.Comment.Space(), originalComment.Comment.Path, originalComment.Comment.Version, cid.Undef, cid.Undef, nil, clock.MustNow())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete comment: %v", err)
	}

	if err := srv.idx.Put(ctx, eb); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store comment deletion: %v", err)
	}

	return &emptypb.Empty{}, nil
}

// GetCommentReplyCount implements Comments API.
func (srv *Server) GetCommentReplyCount(ctx context.Context, in *documents.GetCommentReplyCountRequest) (out *documents.GetCommentReplyCountResponse, err error) {
	resp := &documents.GetCommentReplyCountResponse{}
	rid, err := blob.DecodeRecordID(in.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode comment ID: %v", err)
	}
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, qGetReplyCountByID(), func(stmt *sqlite.Stmt) error {
			resp.ReplyCount = stmt.ColumnInt64(0)
			return nil

		}, rid.Authority, rid.TSID.String()); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}

	return resp, nil
}
