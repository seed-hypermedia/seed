// Package documents implements Documents API v3.
package documents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/apiutil"
	"seed/backend/util/cclock"
	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/errutil"
	"seed/backend/util/maybe"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"strings"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultPageSize    = 100
	maxPageAllocBuffer = 400 // Arbitrary limit to prevent allocating too much memory when client requested huge page size.
)

// Server implements Documents API v3.
type Server struct {
	keys core.KeyStore
	idx  *blob.Index
	db   *sqlitex.Pool
	log  *zap.Logger
}

// NewServer creates a new Documents API v3 server.
func NewServer(keys core.KeyStore, idx *blob.Index, db *sqlitex.Pool, log *zap.Logger) *Server {
	return &Server{
		keys: keys,
		idx:  idx,
		db:   db,
		log:  log,
	}
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	documents.RegisterDocumentsServer(rpc, srv)
	documents.RegisterAccessControlServer(rpc, srv)
	documents.RegisterCommentsServer(rpc, srv)
}

// GetDocument implements Documents API v3.
func (srv *Server) GetDocument(ctx context.Context, in *documents.GetDocumentRequest) (*documents.Document, error) {
	{
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}
	}

	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, err
	}

	heads, err := docmodel.Version(in.Version).Parse()
	if err != nil {
		return nil, err
	}

	doc, err := srv.loadDocument(ctx, ns, in.Path, heads, false)
	if err != nil {
		return nil, err
	}

	return doc.Hydrate(ctx)
}

// CreateDocumentChange implements Documents API v3.
func (srv *Server) CreateDocumentChange(ctx context.Context, in *documents.CreateDocumentChangeRequest) (*documents.Document, error) {
	{
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}

		if in.SigningKeyName == "" {
			return nil, errutil.MissingArgument("signing_key_name")
		}

		if len(in.Changes) == 0 {
			return nil, status.Errorf(codes.InvalidArgument, "at least one change is required")
		}
	}

	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode account %s: %v", in.Account, err)
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	if err := srv.checkWriteAccess(ctx, ns, in.Path, kp); err != nil {
		return nil, err
	}

	if in.Path == "" && ns.Equal(kp.Principal()) {
		if err := srv.ensureProfileGenesis(ctx, kp); err != nil {
			return nil, err
		}
	}

	heads, err := docmodel.Version(in.BaseVersion).Parse()
	if err != nil {
		return nil, err
	}

	doc, err := srv.loadDocument(ctx, ns, in.Path, heads, true)
	if err != nil {
		// If the document is deleted we create a new one, to allow reusing the previously existing path.
		if status.Code(err) != codes.FailedPrecondition {
			return nil, err
		}

		iri, err := makeIRI(ns, in.Path)
		if err != nil {
			return nil, err
		}

		clock := cclock.New()
		doc, err = docmodel.New(iri, clock)
		if err != nil {
			return nil, err
		}
	}

	if in.BaseVersion == "" {
		switch {
		// No base version is allowed for home documents with 1 change (which is the auto-generated genesis change).
		case in.Path == "" && doc.NumChanges() == 1:
		// No base version is allowed for newly created documents, i.e. when there's no changes applied yet.
		case in.Path != "" && doc.NumChanges() == 0:
		// Otherwise it's an error to not provide a base version.
		default:
			return nil, status.Errorf(codes.FailedPrecondition, "document with this path already exists, `base_version` is required for updating existing documents")
		}
	}

	if err := applyChanges(doc, in.Changes); err != nil {
		return nil, err
	}

	var newBlobs []blocks.Block

	var docChange blob.Encoded[*blob.Change]
	if in.Timestamp != nil {
		docChange, err = doc.SignChangeAt(kp, in.Timestamp.AsTime())
		if err != nil {
			return nil, fmt.Errorf("failed to create document change with the provided timestamp: %w", err)
		}
	} else {
		docChange, err = doc.SignChange(kp)
		if err != nil {
			return nil, fmt.Errorf("failed to create document change: %w", err)
		}
	}
	newBlobs = append(newBlobs, docChange)

	ref, err := doc.Ref(kp)
	if err != nil {
		return nil, err
	}
	newBlobs = append(newBlobs, ref)

	if err := srv.idx.PutMany(ctx, newBlobs); err != nil {
		return nil, err
	}

	out, err := srv.GetDocument(ctx, &documents.GetDocumentRequest{
		Account: in.Account,
		Path:    in.Path,
		Version: docChange.CID.String(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "can't load document after creating the change: %v", err)
	}

	return out, nil
}

// ListDirectory implements Documents API v3.
func (srv *Server) ListDirectory(ctx context.Context, in *documents.ListDirectoryRequest) (*documents.ListDirectoryResponse, error) {
	{
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}

		if in.SortOptions == nil {
			in.SortOptions = &documents.SortOptions{
				Attribute:  documents.SortAttribute_ACTIVITY_TIME,
				Descending: true,
			}
		}
	}

	var cursor struct {
		ActivityTime int64  `json:"t,omitempty"` // Only used when filtering by activity time.
		NameOrPath   string `json:"n,omitempty"` // Only used when filtering by name or path.
	}

	switch {
	case in.PageToken == "" && in.SortOptions.Descending:
		cursor.ActivityTime = math.MaxInt64
		cursor.NameOrPath = "\uFFFF" // MaxString.
	case in.PageToken != "":
		if err := apiutil.DecodePageToken(in.PageToken, &cursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	if in.PageSize <= 0 {
		in.PageSize = defaultPageSize
	}

	var (
		query string
		args  colx.Slice[any]
	)
	{
		ns, err := core.DecodePrincipal(in.Account)
		if err != nil {
			return nil, err
		}

		baseIRI, err := blob.NewIRI(ns, in.DirectoryPath)
		if err != nil {
			return nil, err
		}

		qb := baseListDocumentsQuery()

		qb.Where("(r.iri = ? OR r.iri GLOB ?)")
		args.Append(baseIRI, baseIRI+"/*")

		if !in.Recursive {
			qb.Where("r.iri NOT GLOB ?")
			args.Append(baseIRI + "/*/*")
		}

		var (
			order         string
			paginationCmp string
		)
		if in.SortOptions.Descending {
			order = "DESC"
			paginationCmp = "<"
		} else {
			order = "ASC"
			paginationCmp = ">"
		}

		switch in.SortOptions.Attribute {
		case documents.SortAttribute_ACTIVITY_TIME:
			qb.Where("last_activity_time " + paginationCmp + " ?")
			args.Append(cursor.ActivityTime)

			qb.OrderBy("last_activity_time " + order)
		case documents.SortAttribute_NAME:
			qb.Where("COALESCE(dg.metadata->>'name', '') " + paginationCmp + " ?")
			args.Append(cursor.NameOrPath)

			qb.OrderBy("COALESCE(dg.metadata->>'name', '') " + order)
		case documents.SortAttribute_PATH:
			qb.Where("r.iri " + paginationCmp + " ?")
			args.Append(cursor.NameOrPath)

			qb.OrderBy("r.iri " + order)
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported sort attribute %v", in.SortOptions.Attribute)
		}

		args.Append(in.PageSize)
		query = qb.String()
	}

	out := &documents.ListDirectoryResponse{
		Documents: make([]*documents.DocumentInfo, 0, min(in.PageSize, maxPageAllocBuffer)),
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	lookup := blob.NewLookupCache(conn)

	var count int32
	rows, check := sqlitex.Query(conn, query, args...)
	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken, err = apiutil.EncodePageToken(cursor, nil)
			break
		}
		count++

		item, ierr := documentInfoFromRow(lookup, row)
		if ierr != nil {
			err = ierr
			break
		}

		cursor.ActivityTime = item.ActivitySummary.LatestChangeTime.AsTime().UnixMilli()
		cursor.NameOrPath = item.Metadata.Fields["name"].GetStringValue()

		out.Documents = append(out.Documents, item)
	}

	err = errors.Join(err, check())
	if err != nil {
		return nil, err
	}

	return out, nil
}

// ListAccounts implements Documents API v3.
func (srv *Server) ListAccounts(ctx context.Context, in *documents.ListAccountsRequest) (out *documents.ListAccountsResponse, err error) {
	var cursor = struct {
		ID           string `json:"i"`
		ActivityTime int64  `json:"t"`
	}{
		ID:           "\uFFFF", // MaxString.
		ActivityTime: math.MaxInt64,
	}

	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &cursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	if in.PageSize <= 0 {
		in.PageSize = defaultPageSize
	}

	if in.SortOptions == nil {
		in.SortOptions = &documents.SortOptions{
			Attribute:  documents.SortAttribute_ACTIVITY_TIME,
			Descending: true,
		}
	}

	out = &documents.ListAccountsResponse{
		Accounts: make([]*documents.Account, 0, min(in.PageSize, maxPageAllocBuffer)),
	}

	var (
		query string
		args  colx.Slice[any]
	)
	{
		qb := srv.baseAccountQuery().
			Limit("? + 1")

		var (
			order         string
			paginationCmp string
		)
		if in.SortOptions.Descending {
			order = "DESC"
			paginationCmp = "<"
		} else {
			order = "ASC"
			paginationCmp = ">"
		}

		switch in.SortOptions.Attribute {
		case documents.SortAttribute_ACTIVITY_TIME:
			qb.Where(
				"last_activity_time "+paginationCmp+" ?",
				"spaces.id "+paginationCmp+" ?",
			)
			args.Append(cursor.ActivityTime, cursor.ID)

			qb.OrderBy("last_activity_time " + order + ", spaces.id " + order)
		case documents.SortAttribute_NAME, documents.SortAttribute_PATH:
			qb.Where("spaces.id " + paginationCmp + " ?")
			args.Append(cursor.ID)

			qb.OrderBy("spaces.id " + order)
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported sort attribute %v", in.SortOptions.Attribute)
		}

		args.Append(in.PageSize)
		query = qb.String()
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	defer sqlitex.Save(conn)(&err)

	lookup := blob.NewLookupCache(conn)

	var count int32
	rows, check := sqlitex.Query(conn, query, args...)
	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken, err = apiutil.EncodePageToken(cursor, nil)
			break
		}
		count++

		item, err := srv.accountFromRow(row, lookup)
		if err != nil {
			return nil, err
		}

		out.Accounts = append(out.Accounts, item.Proto)

		cursor.ActivityTime = item.LastActivityTime
		cursor.ID = item.SpaceID
	}

	err = errors.Join(err, check())
	if err != nil {
		return nil, err
	}

	return out, nil
}

// GetAccount implements Documents API v3.
func (srv *Server) GetAccount(ctx context.Context, in *documents.GetAccountRequest) (out *documents.Account, err error) {
	{
		if in.Id == "" {
			return nil, errutil.MissingArgument("account")
		}
	}

	if _, err := core.DecodePrincipal(in.Id); err != nil {
		return nil, err
	}

	var (
		query string
		args  colx.Slice[any]
	)
	{
		qb := srv.baseAccountQuery()
		qb = qb.Where("spaces.id = ?")

		args.Append(in.Id)

		query = qb.String()
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	defer sqlitex.Save(conn)(&err)

	lookup := blob.NewLookupCache(conn)

	rows, check := sqlitex.Query(conn, query, args...)
	for row := range rows {
		item, err := srv.accountFromRow(row, lookup)
		if err != nil {
			return nil, err
		}

		out = item.Proto
	}

	err = errors.Join(err, check())
	if err != nil {
		return nil, err
	}

	if out == nil {
		return nil, status.Errorf(codes.NotFound, "account %s is not found", in.Id)
	}

	return out, nil
}

// BatchGetAccounts implements Documents API v3.
func (srv *Server) BatchGetAccounts(ctx context.Context, in *documents.BatchGetAccountsRequest) (out *documents.BatchGetAccountsResponse, err error) {
	{
		if len(in.Ids) == 0 {
			return &documents.BatchGetAccountsResponse{}, nil
		}
	}

	out = &documents.BatchGetAccountsResponse{
		Accounts: make(map[string]*documents.Account, len(in.Ids)),
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	defer sqlitex.Save(conn)(&err)

	lookup := blob.NewLookupCache(conn)

	slices.Sort(in.Ids)
	in.Ids = slices.Compact(in.Ids)

	getAccount := func(id string) (out *documents.Account, err error) {
		if _, err := core.DecodePrincipal(id); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to decode account %s: %v", id, err)
		}

		qb := srv.baseAccountQuery()
		qb = qb.Where("spaces.id = ?")

		rows, check := sqlitex.Query(conn, qb.String(), id)
		for row := range rows {
			item, err := srv.accountFromRow(row, lookup)
			if err != nil {
				return nil, err
			}
			out = item.Proto
		}

		err = errors.Join(err, check())
		if err != nil {
			return nil, err
		}

		if out == nil {
			return nil, status.Errorf(codes.NotFound, "account %s is not found", id)
		}

		return out, nil
	}

	for _, id := range in.Ids {
		acc, err := getAccount(id)
		if err != nil {
			if out.Errors == nil {
				out.Errors = make(map[string][]byte, len(in.Ids))
			}

			sterr, ok := status.FromError(err)
			if !ok {
				sterr = status.New(codes.Internal, err.Error())
			}

			data, err := proto.Marshal(sterr.Proto())
			if err != nil {
				return nil, err
			}

			out.Errors[id] = data
		}

		out.Accounts[id] = acc
	}

	return out, nil
}

type dbAccount struct {
	Proto *documents.Account

	// Data for pagination.
	SpaceID          string
	LastActivityTime int64
}

func (srv *Server) baseAccountQuery() *dqb.SelectQuery {
	return dqb.
		Select(
			"spaces.id",
			"spaces.last_comment",
			"spaces.last_comment_time",
			"spaces.comment_count",
			"spaces.last_change_time",
			"MAX(last_comment_time, last_change_time) AS last_activity_time",
			"subs.id IS NOT NULL AS is_subscribed",
			"(SELECT 1 FROM unread_resources WHERE iri >= 'hm://' || spaces.id AND iri < 'hm://' || spaces.id || X'FFFF') AS is_unread",
			"(SELECT metadata FROM document_generations WHERE resource = (SELECT resources.id FROM resources WHERE iri = 'hm://' || spaces.id) GROUP BY resource HAVING generation = MAX(generation)) AS metadata",
			"(SELECT extra_attrs->>'alias' FROM structural_blobs WHERE author = (SELECT resources.id FROM resources WHERE iri = 'hm://' || spaces.id) AND type = 'Profile' AND extra_attrs->>'alias' IS NOT NULL) AS alias",
		).
		From("spaces").
		LeftJoin("(SELECT DISTINCT substr(iri, 6, 48) AS id FROM subscriptions) subs", "spaces.id = subs.id")
}

func (srv *Server) accountFromRow(row *sqlite.Stmt, lookup *blob.LookupCache) (*dbAccount, error) {
	seq := sqlite.NewIncrementor(0)
	var (
		spaceID          = row.ColumnText(seq())
		lastCommentID    = row.ColumnInt64(seq())
		lastCommentTime  = row.ColumnInt64(seq())
		commentCount     = row.ColumnInt64(seq())
		lastChangeTime   = row.ColumnInt64(seq())
		lastActivityTime = row.ColumnInt64(seq())
		isSubscribed     = row.ColumnInt(seq()) != 0
		isUnread         = row.ColumnInt64(seq()) > 0
		metadataJSON     = row.ColumnBytesUnsafe(seq())
		aliasID          = row.ColumnInt64(seq())
	)

	var attrs blob.DocIndexedAttrs
	if err := json.Unmarshal(metadataJSON, &attrs); err != nil {
		srv.log.Warn("Unmarshal error", zap.Any("metadataJSON", metadataJSON), zap.Error(err))
	}
	metadata := make(map[string]any, len(attrs))
	for k, v := range attrs {
		if v.Value != nil {
			colx.ObjectSet(metadata, strings.Split(k, "."), v.Value)
		}
	}

	var (
		latestCommentID   string
		latestCommentTime *timestamppb.Timestamp
	)
	if lastCommentID != 0 {
		lc, err := lookup.CID(lastCommentID)
		if err != nil {
			return nil, err
		}

		latestCommentID = lc.String()
		latestCommentTime = timestamppb.New(time.UnixMilli(lastCommentTime))
	}

	metastruct, err := structpb.NewStruct(metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to collect struct metadata: %w", err)
	}

	var alias string
	if aliasID != 0 {
		aliasKey, err := lookup.PublicKey(aliasID)
		if err != nil {
			return nil, err
		}

		alias = aliasKey.String()
	}

	item := &documents.Account{
		Id:       spaceID,
		Metadata: metastruct,
		ActivitySummary: &documents.ActivitySummary{
			CommentCount:      int32(commentCount), //nolint:gosec
			LatestCommentId:   latestCommentID,
			LatestCommentTime: latestCommentTime,
			LatestChangeTime:  timestamppb.New(time.UnixMilli(lastChangeTime)),
			IsUnread:          isUnread,
		},
		IsSubscribed: isSubscribed,
		AliasAccount: alias,
	}

	return &dbAccount{
		Proto:            item,
		SpaceID:          spaceID,
		LastActivityTime: lastActivityTime,
	}, nil
}

// ListRootDocuments implements Documents API v3.
func (srv *Server) ListRootDocuments(ctx context.Context, in *documents.ListRootDocumentsRequest) (*documents.ListRootDocumentsResponse, error) {
	var cursor = struct {
		IRI          string `json:"i"`
		ActivityTime int64  `json:"t"`
	}{
		IRI:          "\uFFFF", // MaxString.
		ActivityTime: math.MaxInt64,
	}

	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &cursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	if in.PageSize <= 0 {
		in.PageSize = 30
	}

	out := &documents.ListRootDocumentsResponse{
		Documents: make([]*documents.DocumentInfo, 0, min(in.PageSize, maxPageAllocBuffer)),
	}

	var (
		query string
		args  colx.Slice[any]
	)
	{
		qb := baseListDocumentsQuery().OrderBy("last_activity_time DESC")

		qb.Where("r.iri GLOB 'hm://*'")
		qb.Where("r.iri NOT GLOB 'hm://*/*'")

		qb.Where("last_activity_time < ?", "r.iri < ?")
		args.Append(cursor.ActivityTime, cursor.IRI)

		args.Append(in.PageSize)
		query = qb.String()
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	lookup := blob.NewLookupCache(conn)

	var count int32
	rows, check := sqlitex.Query(conn, query, args...)
	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken, err = apiutil.EncodePageToken(cursor, nil)
			break
		}
		count++

		item, ierr := documentInfoFromRow(lookup, row)
		if ierr != nil {
			err = ierr
			break
		}

		cursor.ActivityTime = item.ActivitySummary.LatestChangeTime.AsTime().UnixMilli()
		cursor.IRI = "hm://" + item.Account + "/" + item.Path
		cursor.IRI = strings.TrimSuffix(cursor.IRI, "/")

		out.Documents = append(out.Documents, item)
	}

	err = errors.Join(err, check())
	if err != nil {
		return nil, err
	}

	return out, nil
}

// ListDocuments implements Documents API v3.
func (srv *Server) ListDocuments(ctx context.Context, in *documents.ListDocumentsRequest) (*documents.ListDocumentsResponse, error) {
	var cursor = struct {
		IRI          string `json:"i"`
		ActivityTime int64  `json:"t"`
	}{
		IRI:          "\uFFFF", // MaxString.
		ActivityTime: math.MaxInt64,
	}

	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &cursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	if in.PageSize <= 0 {
		in.PageSize = defaultPageSize
	}

	out := &documents.ListDocumentsResponse{
		Documents: make([]*documents.DocumentInfo, 0, min(in.PageSize, maxPageAllocBuffer)),
	}

	var (
		query string
		args  colx.Slice[any]
	)
	{
		qb := baseListDocumentsQuery().OrderBy("last_activity_time DESC")

		if in.Account == "" {
			qb.Where("r.iri GLOB 'hm://*'")
		} else {
			ns, err := core.DecodePrincipal(in.Account)
			if err != nil {
				return nil, fmt.Errorf("failed to decode account: %w", err)
			}

			iri, err := blob.NewIRI(ns, "")
			if err != nil {
				return nil, err
			}

			qb.Where("(r.iri = ? OR r.iri GLOB ?)")
			args.Append(iri, iri+"/*")
		}

		qb.Where("last_activity_time < ?", "r.iri < ?")
		args.Append(cursor.ActivityTime, cursor.IRI)

		args.Append(in.PageSize)
		query = qb.String()
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	lookup := blob.NewLookupCache(conn)

	var count int32
	rows, check := sqlitex.Query(conn, query, args...)
	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken, err = apiutil.EncodePageToken(cursor, nil)
			break
		}
		count++

		item, ierr := documentInfoFromRow(lookup, row)
		if ierr != nil {
			err = ierr
			break
		}

		cursor.ActivityTime = item.ActivitySummary.LatestChangeTime.AsTime().UnixMilli()
		cursor.IRI = "hm://" + item.Account + "/" + item.Path
		cursor.IRI = strings.TrimSuffix(cursor.IRI, "/")

		out.Documents = append(out.Documents, item)
	}

	err = errors.Join(err, check())
	if err != nil {
		return nil, err
	}

	return out, nil
}

func baseListDocumentsQuery() *dqb.SelectQuery {
	// Page size must be the last binding parameter.
	return dqb.
		Select(
			"r.iri",
			"dg.genesis",
			"dg.generation",
			"dg.metadata",
			"dg.comment_count",
			"dg.heads",
			"dg.authors",
			"dg.genesis_change_time",
			"dg.last_comment",
			"dg.last_comment_time",
			"dg.last_change_time",
			"dg.last_activity_time",
			"(SELECT 1 FROM unread_resources WHERE iri = r.iri) AS is_unread",
		).
		From(
			"document_generations dg",
			"resources r",
		).
		Where("r.id = dg.resource", "dg.is_deleted = 0").
		GroupBy("dg.resource HAVING dg.generation = MAX(dg.generation)").
		Limit("? + 1")
}

func documentInfoFromRow(lookup *blob.LookupCache, row *sqlite.Stmt) (*documents.DocumentInfo, error) {
	inc := sqlite.NewIncrementor(0)
	var (
		iriRaw            = row.ColumnText(inc())
		genesis           = row.ColumnText(inc())
		generation        = row.ColumnInt64(inc())
		metadataJSON      = row.ColumnBytesUnsafe(inc())
		commentCount      = row.ColumnInt64(inc())
		headsJSON         = row.ColumnBytesUnsafe(inc())
		authorsJSON       = row.ColumnBytesUnsafe(inc())
		genesisChangeTime = row.ColumnInt64(inc())
		lastCommentID     = row.ColumnInt64(inc())
		lastCommentTime   = row.ColumnInt64(inc())
		lastChangeTime    = row.ColumnInt64(inc())
		lastActivityTime  = row.ColumnInt64(inc())
		_                 = lastActivityTime
		isUnread          = row.ColumnInt64(inc()) > 0
	)

	iri := blob.IRI(iriRaw)
	space, path, err := iri.SpacePath()
	if err != nil {
		return nil, err
	}

	var attrs blob.DocIndexedAttrs
	if err := json.Unmarshal(metadataJSON, &attrs); err != nil {
		return nil, err
	}

	metadata := make(map[string]any, len(attrs))
	for k, v := range attrs {
		if v.Value != nil {
			colx.ObjectSet(metadata, strings.Split(k, "."), v.Value)
		}
	}

	var authorIDs []int64
	if err := json.Unmarshal(authorsJSON, &authorIDs); err != nil {
		return nil, err
	}

	authors := make([]string, len(authorIDs))
	for i, a := range authorIDs {
		aa, err := lookup.PublicKey(a)
		if err != nil {
			return nil, err
		}
		authors[i] = aa.String()
	}

	var headIDs []int64
	if err := json.Unmarshal(headsJSON, &headIDs); err != nil {
		return nil, err
	}

	cids := make([]cid.Cid, len(headIDs))
	for i, h := range headIDs {
		cids[i], err = lookup.CID(h)
		if err != nil {
			return nil, err
		}
	}

	crumbIRIs := iri.Breadcrumbs()
	crumbIRIs = crumbIRIs[:len(crumbIRIs)-1] // Minus 1 to skip the current document.

	var crumbs []*documents.Breadcrumb
	if len(crumbIRIs) > 0 {
		crumbs = make([]*documents.Breadcrumb, len(crumbIRIs))

		for i, iri := range crumbIRIs[:len(crumbIRIs)-1] { // Minus one to skip the current document
			title, found, err := lookup.DocumentTitle(iri)
			if err != nil {
				return nil, err
			}

			_, path, err := iri.SpacePath()
			if err != nil {
				return nil, err
			}

			crumb := &documents.Breadcrumb{
				Name:      title,
				Path:      path,
				IsMissing: !found,
			}

			crumbs[i] = crumb
		}
	}

	var (
		latestComment     string
		latestCommentTime *timestamppb.Timestamp
	)
	if lastCommentID != 0 {
		lc, err := lookup.CID(lastCommentID)
		if err != nil {
			return nil, err
		}
		latestComment = lc.String()
		latestCommentTime = timestamppb.New(time.UnixMilli(lastCommentTime))
	}

	metastruct, err := structpb.NewStruct(metadata)
	if err != nil {
		return nil, err
	}

	out := &documents.DocumentInfo{
		Account:     space.String(),
		Path:        path,
		Metadata:    metastruct,
		Authors:     authors,
		CreateTime:  timestamppb.New(time.UnixMilli(genesisChangeTime)),
		UpdateTime:  timestamppb.New(time.UnixMilli(lastChangeTime)),
		Genesis:     genesis,
		Version:     blob.NewVersion(cids...).String(),
		Breadcrumbs: crumbs,
		ActivitySummary: &documents.ActivitySummary{
			CommentCount:      int32(commentCount), //nolint:gosec
			LatestCommentId:   latestComment,
			LatestCommentTime: latestCommentTime,
			LatestChangeTime:  timestamppb.New(time.UnixMilli(lastChangeTime)),
			IsUnread:          isUnread,
		},
		GenerationInfo: &documents.GenerationInfo{
			Genesis:    genesis,
			Generation: generation,
		},
	}

	return out, nil
}

// DeleteDocument implements Documents API v3.
func (srv *Server) DeleteDocument(ctx context.Context, in *documents.DeleteDocumentRequest) (*emptypb.Empty, error) {
	return nil, status.Error(codes.Unimplemented, "Deprecated: Use CreateRef")
}

// UpdateDocumentReadStatus implements Documents API v3.
func (srv *Server) UpdateDocumentReadStatus(ctx context.Context, in *documents.UpdateDocumentReadStatusRequest) (*emptypb.Empty, error) {
	{
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}
	}

	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, err
	}

	iri, err := blob.NewIRI(ns, in.Path)
	if err != nil {
		return nil, err
	}

	if err := srv.idx.SetReadStatus(ctx, iri, in.IsRead, in.IsRecursive); err != nil {
		return nil, err
	}

	return &emptypb.Empty{}, nil
}

// CreateRef implements Documents API v3.
func (srv *Server) CreateRef(ctx context.Context, in *documents.CreateRefRequest) (*documents.Ref, error) {
	{
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}

		if in.SigningKeyName == "" {
			return nil, errutil.MissingArgument("signing_key_name")
		}

		if in.Target == nil {
			return nil, errutil.MissingArgument("target")
		}
	}

	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "faield to decode account ID: %v", err)
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	if err := srv.checkWriteAccess(ctx, ns, in.Path, kp); err != nil {
		return nil, err
	}

	var ts time.Time
	if in.Timestamp != nil {
		ts = in.Timestamp.AsTime().Round(blob.ClockPrecision)
	} else {
		ts = cclock.New().MustNow()
	}

	doc, err := srv.loadDocument(ctx, ns, in.Path, nil, true)
	if err != nil {
		return nil, err
	}

	if in.Generation == 0 {
		in.Generation = doc.Generation.Value()
	}

	var refBlob blob.Encoded[*blob.Ref]

	switch rt := in.Target.Target.(type) {
	case *documents.RefTarget_Version_:
		heads, err := blob.Version(rt.Version.Version).Parse()
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to parse version: %v", err)
		}

		genesis, err := cid.Decode(rt.Version.Genesis)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to parse genesis: %v", err)
		}

		// If there's an existing document, we want to make sure the genesis of the ref we are creating is the same.
		if len(doc.Heads()) > 0 {
			if !doc.Genesis().Equals(genesis) && in.Generation <= doc.Generation.Value() {
				return nil, status.Errorf(codes.FailedPrecondition, "There's already a Ref for this path with a different genesis. Provide an explicit generation number higher than %d to overwrite.", doc.Generation.Value())
			}
		}

		refBlob, err = blob.NewRef(kp, in.Generation, genesis, ns, in.Path, heads, ts)
		if err != nil {
			return nil, err
		}
	case *documents.RefTarget_Tombstone_:
		refBlob, err = blob.NewRef(kp, in.Generation, doc.Genesis(), ns, in.Path, nil, ts)
		if err != nil {
			return nil, err
		}
	case *documents.RefTarget_Redirect_:
		var targetSpace core.Principal
		if rt.Redirect.Account == "" {
			targetSpace = ns
		} else {
			targetSpace, err = core.DecodePrincipal(rt.Redirect.Account)
			if err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "invalid redirect account")
			}
		}

		if _, err := blob.NewIRI(targetSpace, rt.Redirect.Path); err != nil {
			return nil, err
		}

		target := blob.RedirectTarget{
			Space: targetSpace,
			Path:  rt.Redirect.Path,
		}

		refBlob, err = blob.NewRefRedirect(kp, in.Generation, doc.Genesis(), ns, in.Path, target, ts)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("BUG: unhandled ref target type %T", rt)
	}

	if err := srv.idx.Put(ctx, refBlob); err != nil {
		return nil, err
	}

	return refToProto(refBlob.CID, refBlob.Decoded)
}

// GetRef implements Documents API v3.
func (srv *Server) GetRef(ctx context.Context, in *documents.GetRefRequest) (*documents.Ref, error) {
	if in.Id == "" {
		return nil, errutil.MissingArgument("id")
	}

	c, err := cid.Decode(in.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse Ref ID: %v", err)
	}

	ref, err := srv.getRef(ctx, c)
	if err != nil {
		return nil, err
	}

	return refToProto(ref.CID, ref.Value)
}

// CreateAlias implements Documents API v3.
func (srv *Server) CreateAlias(ctx context.Context, in *documents.CreateAliasRequest) (*emptypb.Empty, error) {
	{
		if in.SigningKeyName == "" {
			return nil, errutil.MissingArgument("signing_key_name")
		}

		if in.AliasAccount == "" {
			return nil, errutil.MissingArgument("alias_account")
		}
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	targetAccount, err := core.DecodePrincipal(in.AliasAccount)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode target account: %v", err)
	}

	// Check if the signing key has agent capability for the target account
	valid, err := srv.idx.IsValidAgent(ctx, targetAccount, kp.Principal())
	if err != nil {
		return nil, err
	}

	if !valid {
		return nil, status.Errorf(codes.PermissionDenied, "key '%s' is not allowed to create an alias for account '%s'", kp.Principal(), targetAccount)
	}

	sb, err := blob.NewProfileAlias(kp, targetAccount, cclock.New().MustNow())
	if err != nil {
		return nil, err
	}

	if err := srv.idx.Put(ctx, sb); err != nil {
		return nil, err
	}

	return &emptypb.Empty{}, nil
}

func refToProto(c cid.Cid, ref *blob.Ref) (*documents.Ref, error) {
	pb := &documents.Ref{
		Id:        c.String(),
		Account:   ref.Space().String(),
		Path:      ref.Path,
		Signer:    ref.Signer.String(),
		Timestamp: timestamppb.New(ref.Ts),
		GenerationInfo: &documents.GenerationInfo{
			Genesis:    ref.GenesisBlob.String(),
			Generation: ref.Generation,
		},
	}

	switch {
	case ref.GenesisBlob.Defined() && len(ref.Heads) > 0:
		pb.Target = &documents.RefTarget{
			Target: &documents.RefTarget_Version_{
				Version: &documents.RefTarget_Version{
					Genesis: ref.GenesisBlob.String(),
					Version: string(blob.NewVersion(ref.Heads...)),
				},
			},
		}
	case ref.GenesisBlob.Defined() && len(ref.Heads) == 0:
		pb.Target = &documents.RefTarget{
			Target: &documents.RefTarget_Tombstone_{
				Tombstone: &documents.RefTarget_Tombstone{},
			},
		}
	default:
		return nil, fmt.Errorf("refToProto: invalid original ref %s: %+v", c, ref)
	}

	return pb, nil
}

func (srv *Server) getRef(ctx context.Context, c cid.Cid) (hb blob.WithCID[*blob.Ref], err error) {
	blk, err := srv.idx.Get(ctx, c)
	if err != nil {
		return hb, err
	}

	ref := &blob.Ref{}
	if err := cbornode.DecodeInto(blk.RawData(), ref); err != nil {
		return hb, err
	}

	return blob.WithCID[*blob.Ref]{
		CID:   blk.Cid(),
		Value: ref,
	}, nil
}

func (srv *Server) ensureProfileGenesis(ctx context.Context, kp *core.KeyPair) error {
	ebc, err := blob.NewChange(kp, cid.Undef, nil, 0, blob.ChangeBody{}, blob.ZeroUnixTime())
	if err != nil {
		return err
	}

	iri, err := makeIRI(kp.Principal(), "")
	if err != nil {
		return err
	}

	space, path, err := iri.SpacePath()
	if err != nil {
		return err
	}

	ebr, err := blob.NewRef(kp, 0, ebc.CID, space, path, []cid.Cid{ebc.CID}, blob.ZeroUnixTime())
	if err != nil {
		return err
	}

	if err := srv.idx.PutMany(ctx, []blocks.Block{ebc, ebr}); err != nil {
		return err
	}

	return nil
}

func makeIRI(account core.Principal, path string) (blob.IRI, error) {
	return blob.NewIRI(account, path)
}

func (srv *Server) loadDocument(ctx context.Context, account core.Principal, path string, heads []cid.Cid, ensurePath bool) (*docmodel.Document, error) {
	iri, err := makeIRI(account, path)
	if err != nil {
		return nil, err
	}

	clock := cclock.New()
	doc, err := docmodel.New(iri, clock)
	if err != nil {
		return nil, err
	}

	changes, check := srv.idx.IterChanges(ctx, iri, heads)
	for ch := range changes {
		if doc.Generation.IsSet() {
			if doc.Generation.Value() != ch.Generation {
				err = fmt.Errorf("BUG: IterChanges returned changes with different generations")
				break
			}
		} else {
			doc.Generation = maybe.New(ch.Generation)
		}

		if aerr := doc.ApplyChange(ch.CID, ch.Data); aerr != nil {
			err = errors.Join(err, aerr)
			break
		}
	}
	err = errors.Join(err, check())
	if err != nil && !(status.Code(err) == codes.FailedPrecondition && ensurePath) {
		return nil, err
	}

	if len(doc.Heads()) == 0 {
		if !ensurePath {
			return nil, status.Errorf(codes.NotFound, "document not found: %s", iri)
		}

		doc.Generation = maybe.New(cclock.New().MustNow().UnixMilli())
	}

	return doc, nil
}

func applyChanges(doc *docmodel.Document, ops []*documents.DocumentChange) error {
	for _, op := range ops {
		switch o := op.Op.(type) {
		case *documents.DocumentChange_SetMetadata_:
			if err := doc.SetMetadata(o.SetMetadata.Key, o.SetMetadata.Value); err != nil {
				return err
			}
		case *documents.DocumentChange_MoveBlock_:
			if err := doc.MoveBlock(o.MoveBlock.BlockId, o.MoveBlock.Parent, o.MoveBlock.LeftSibling); err != nil {
				return err
			}
		case *documents.DocumentChange_DeleteBlock:
			if err := doc.DeleteBlock(o.DeleteBlock); err != nil {
				return err
			}
		case *documents.DocumentChange_ReplaceBlock:
			if err := doc.ReplaceBlock(o.ReplaceBlock); err != nil {
				return err
			}
		case *documents.DocumentChange_SetAttribute_:
			if err := doc.SetAttribute(o.SetAttribute.BlockId, o.SetAttribute.Key, getInterfaceValue(o.SetAttribute)); err != nil {
				return err
			}
		default:
			return status.Errorf(codes.Unimplemented, "unknown operation %T", o)
		}
	}

	return nil
}

func getInterfaceValue(op *documents.DocumentChange_SetAttribute) any {
	switch v := op.Value.(type) {
	case *documents.DocumentChange_SetAttribute_StringValue:
		return v.StringValue
	case *documents.DocumentChange_SetAttribute_IntValue:
		return v.IntValue
	case *documents.DocumentChange_SetAttribute_BoolValue:
		return v.BoolValue
	case *documents.DocumentChange_SetAttribute_NullValue:
		return nil
	default:
		panic(fmt.Errorf("TODO: unhandled value type in SetAttribute operation: %T", op.Value))
	}
}

func (srv *Server) checkWriteAccess(ctx context.Context, account core.Principal, path string, kp *core.KeyPair) error {
	valid, err := srv.idx.IsValidWriter(ctx, account, path, kp.Principal())
	if err != nil {
		return err
	}

	if !valid {
		return status.Errorf(codes.PermissionDenied, "key '%s' is not allowed to write to space '%s' in path '%s'", kp.Principal(), account, path)
	}

	return nil
}

// DocumentToListItem converts a document to a document list item.
func DocumentToListItem(doc *documents.Document) *documents.DocumentInfo {
	return &documents.DocumentInfo{
		Account:        doc.Account,
		Path:           doc.Path,
		Metadata:       doc.Metadata,
		Authors:        doc.Authors,
		CreateTime:     doc.CreateTime,
		UpdateTime:     doc.UpdateTime,
		Genesis:        doc.Genesis,
		Version:        doc.Version,
		GenerationInfo: doc.GenerationInfo,
	}
}
