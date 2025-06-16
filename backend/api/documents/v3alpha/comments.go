package documents

import (
	"context"
	"errors"
	"fmt"
	"iter"
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
				return fmt.Errorf("reply parent %s not found: %w", in.ReplyParent, err)
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

	encodedBlob, err := blob.NewComment(kp, cid.Undef, space, in.TargetPath, versionHeads, threadRoot, replyParent, commentContentFromProto(in.Content), clock.MustNow())
	if err != nil {
		return nil, err
	}

	if err := srv.idx.Put(ctx, encodedBlob); err != nil {
		return nil, err
	}

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (*documents.Comment, error) {
		lookup := blob.NewLookupCache(conn)
		return commentToProto(lookup, encodedBlob.CID, encodedBlob.Decoded, encodedBlob.TSID())
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

	// TODO(burdiyan): implement pagination.
	resp := &documents.ListCommentsResponse{}

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (*documents.ListCommentsResponse, error) {
		lookup := blob.NewLookupCache(conn)
		var outErr error
		comments, check := srv.iterComments(conn, iri)
		for cmt := range comments {
			pb, err := commentToProto(lookup, cmt.CID, cmt.Comment, cmt.TSID)
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

	resp := &documents.ListCommentsResponse{
		Comments: make([]*documents.Comment, 0, min(in.PageSize, maxPageAllocBuffer)),
	}

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (*documents.ListCommentsResponse, error) {
		lookup := blob.NewLookupCache(conn)
		var outErr error
		comments, check := srv.iterCommentsByAuthor(ctx, author, cursor.CommentID, in.PageSize+1)
		for result := range comments {
			if len(resp.Comments) == int(in.PageSize) {
				resp.NextPageToken, err = apiutil.EncodePageToken(cursor, nil)
				if err != nil {
					return nil, status.Errorf(codes.Internal, "failed to encode page token: %v", err)
				}
				break
			}

			pb, err := commentToProto(lookup, result.CID, result.Comment, result.TSID)
			if err != nil {
				outErr = err
				break
			}
			resp.Comments = append(resp.Comments, pb)

			cursor.CommentID = result.DBID
		}
		outErr = errors.Join(outErr, check())
		if outErr != nil {
			return nil, outErr
		}

		return resp, nil
	})
}

type indexedComment struct {
	DBID    int64
	CID     cid.Cid
	TSID    blob.TSID
	Comment *blob.Comment
}

func (srv *Server) iterComments(conn *sqlite.Conn, resource blob.IRI) (it iter.Seq[indexedComment], check func() error) {
	var outErr error

	check = func() error { return outErr }
	it = func(yield func(indexedComment) bool) {
		buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
		rows, check := sqlitex.Query(conn, qIterComments(), resource)
		for row := range rows {
			seq := sqlite.NewIncrementor(0)
			var (
				id    = row.ColumnInt64(seq())
				codec = row.ColumnInt64(seq())
				hash  = row.ColumnBytesUnsafe(seq())
				data  = row.ColumnBytesUnsafe(seq())
				tsid  = row.ColumnText(seq())
			)

			buf, err := srv.idx.Decompress(data, buf)
			if err != nil {
				outErr = err
				break
			}

			c := cid.NewCidV1(uint64(codec), hash)
			cmt := &blob.Comment{}
			if err := cbornode.DecodeInto(buf, cmt); err != nil {
				outErr = fmt.Errorf("WalkChanges: failed to decode change %s for entity %s: %w", c, resource, err)
				break
			}

			if !yield(indexedComment{
				DBID:    id,
				CID:     c,
				TSID:    blob.TSID(tsid),
				Comment: cmt,
			}) {
				break
			}

			buf = buf[:0] // reset the slice reusing the backing array
		}

		outErr = errors.Join(outErr, check())
	}

	return it, check
}

var qIterComments = dqb.Str(`
	SELECT
        sb.id,
		b.codec,
		b.multihash,
		b.data,
		sb.extra_attrs->>'tsid' AS tsid
	FROM structural_blobs sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.type = 'Comment'
	AND sb.resource = (SELECT id FROM resources WHERE iri = :iri)
	ORDER BY sb.ts
`)

func (srv *Server) iterCommentsByAuthor(ctx context.Context, author core.Principal, afterID int64, limit int32) (it iter.Seq[indexedComment], check func() error) {
	var outErr error

	check = func() error { return outErr }
	it = func(yield func(indexedComment) bool) {
		conn, release, err := srv.db.Conn(ctx)
		if err != nil {
			outErr = err
			return
		}
		defer release()

		buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
		rows, check := sqlitex.Query(conn, qIterCommentsByAuthor(), author, afterID, limit)
		for row := range rows {
			seq := sqlite.NewIncrementor(0)
			var (
				sbID  = row.ColumnInt64(seq())
				codec = row.ColumnInt64(seq())
				hash  = row.ColumnBytesUnsafe(seq())
				data  = row.ColumnBytesUnsafe(seq())
				tsid  = row.ColumnText(seq())
			)

			buf, err = srv.idx.Decompress(data, buf)
			if err != nil {
				outErr = err
				break
			}

			chcid := cid.NewCidV1(uint64(codec), hash)
			cmt := &blob.Comment{}
			if err := cbornode.DecodeInto(buf, cmt); err != nil {
				outErr = fmt.Errorf("IterCommentsByAuthor: failed to decode comment %s for author %s: %w", chcid, author, err)
				break
			}

			if !yield(indexedComment{
				DBID:    sbID,
				CID:     chcid,
				Comment: cmt,
				TSID:    blob.TSID(tsid),
			}) {
				break
			}

			buf = buf[:0] // reset the slice reusing the backing array
		}

		outErr = errors.Join(outErr, check())
	}

	return it, check
}

var qIterCommentsByAuthor = dqb.Str(`
	SELECT
		sb.id,
		b.codec,
		b.multihash,
		b.data,
		sb.extra_attrs->>'tsid' AS tsid
	FROM structural_blobs sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.type = 'Comment'
	AND sb.author = (SELECT id FROM public_keys WHERE principal = :author)
	AND sb.id < :afterID
	ORDER BY sb.id DESC
	LIMIT :limit
`)

func (srv *Server) getComment(conn *sqlite.Conn, idRaw string) (indexedComment, error) {
	var (
		query string
		args  []any
	)
	{
		rid, err := blob.DecodeRecordID(idRaw)
		if err != nil {
			// We allow to get comment by ID or CID.
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

	var icmt indexedComment
	buf := make([]byte, 0, 1024*1024) // preallocating 1MB for decompression.
	rows, check := sqlitex.Query(conn, query, args...)
	var err error
	for row := range rows {
		seq := sqlite.NewIncrementor(0)
		var (
			sbID  = row.ColumnInt64(seq())
			codec = row.ColumnInt64(seq())
			hash  = row.ColumnBytesUnsafe(seq())
			data  = row.ColumnBytesUnsafe(seq())
			tsid  = row.ColumnText(seq())
		)

		buf, err = srv.idx.Decompress(data, buf)
		if err != nil {
			break
		}

		chcid := cid.NewCidV1(uint64(codec), hash)
		cmt := &blob.Comment{}
		err = cbornode.DecodeInto(buf, cmt)
		if err != nil {
			err = fmt.Errorf("getComment: failed to decode comment %s: %w", chcid, err)
			break
		}

		icmt = indexedComment{
			DBID:    sbID,
			CID:     chcid,
			Comment: cmt,
			TSID:    blob.TSID(tsid),
		}
		break
	}
	if err := errors.Join(err, check()); err != nil {
		return indexedComment{}, err
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

func commentToProto(lookup *blob.LookupCache, c cid.Cid, cmt *blob.Comment, tsid blob.TSID) (*documents.Comment, error) {
	content, err := commentContentToProto(cmt.Body)
	if err != nil {
		return nil, err
	}

	pb := &documents.Comment{
		Id:            blob.RecordID{Authority: cmt.Signer, TSID: tsid}.String(),
		TargetAccount: cmt.Space().String(),
		TargetPath:    cmt.Path,
		TargetVersion: docmodel.NewVersion(cmt.Version...).String(),
		Author:        cmt.Signer.String(),
		Content:       content,
		CreateTime:    timestamppb.New(cmt.Ts),
		Version:       c.String(),
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
