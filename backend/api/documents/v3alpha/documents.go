// Package documents implements Documents API v3.
package documents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"seed/backend/api/documents/v3alpha/docmodel"
	telemetry "seed/backend/api/telemetry/v1alpha"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/hmnet"
	"seed/backend/util/apiutil"
	"seed/backend/util/cclock"
	"seed/backend/util/colx"
	"seed/backend/util/dqb"
	"seed/backend/util/errutil"
	"seed/backend/util/lwwmap"
	"seed/backend/util/maybe"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"strings"
	"time"

	"github.com/invopop/validation"
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
	defaultPageSize                = 100
	maxPageAllocBuffer             = 400 // Arbitrary limit to prevent allocating too much memory when client requested huge page size.
	publicOnlyListVisibilityFilter = `COALESCE(json_extract(dg.metadata, '$."$db.visibility".v'), '') IS NOT 'Private'`
)

var authenticatedListVisibilityFilter = `(
	COALESCE(json_extract(dg.metadata, '$."$db.visibility".v'), '') IS NOT 'Private'
	OR ` + blob.SQLCanWriteRootByOwnerID("r.owner") + `
)`

// Server implements Documents API v3.
type Server struct {
	cfg       config.Base
	keys      core.KeyStore
	idx       *blob.Index
	db        *sqlitex.Pool
	log       *zap.Logger
	p2p       *hmnet.Node
	telemetry *telemetry.Server
	hydrated  *hydrateCache
}

// NewServer creates a new Documents API v3 server.
func NewServer(cfg config.Base, keys core.KeyStore, idx *blob.Index, db *sqlitex.Pool, log *zap.Logger, p2p *hmnet.Node) *Server {
	srv := &Server{
		cfg:      cfg,
		keys:     keys,
		idx:      idx,
		db:       db,
		log:      log,
		p2p:      p2p,
		hydrated: newHydrateCache(),
	}

	// Let the indexer derive a fallback cover image at index time, reusing the
	// real docmodel so the result matches what the read path renders. This is
	// how the derived cover field gets populated. The daemon also wires this
	// earlier (before the backfill reindex task starts); this keeps embedders
	// and tests that construct the server directly working.
	idx.SetDeriveFirstContentImage(DeriveFirstContentImage)

	return srv
}

// DeriveFirstContentImage rebuilds a document in memory from the given changes
// and returns the link of its first image block in reading order (or "" if it
// has none). It's injected into the indexer (SetDeriveFirstContentImage) to
// populate DocumentInfo.first_image_in_content, letting directory
// cards render a fallback cover from fast metadata instead of fetching each
// child's full document. It's a pure function so the daemon can wire it before
// the migration-triggered backfill reindex starts, long before this server
// exists.
//
// The changes are supplied by the indexer (already loaded on its transaction's
// connection), so this does no database I/O and is safe to call mid-indexing.
// It mirrors loadDocument's in-memory build but never touches the pool.
func DeriveFirstContentImage(iri blob.IRI, changes []blob.ChangeRecord) (string, error) {
	if len(changes) == 0 {
		return "", nil
	}

	doc, err := docmodel.New(iri, cclock.New())
	if err != nil {
		return "", err
	}

	for _, ch := range changes {
		doc.SetVisibility(ch.Visibility)
		if !doc.Generation.IsSet() {
			doc.Generation = maybe.New(ch.Generation)
		}
		if err := doc.ApplyChange(ch.CID, ch.Data); err != nil {
			return "", err
		}
	}

	return doc.FirstContentImage(), nil
}

// SetTelemetry wires the journeys profiler. Optional; when nil, all
// telemetry emitters are no-ops.
func (srv *Server) SetTelemetry(t *telemetry.Server) {
	srv.telemetry = t
}

// emitTelemetry records a single checkpoint for the given hm:// URL.
// No-op when telemetry is disabled or the key is empty.
func (srv *Server) emitTelemetry(key, stage string) {
	if srv.telemetry == nil || key == "" {
		return
	}
	srv.telemetry.RecordCheckpoint(key, stage, time.Time{})
}

// documentTelemetryKey builds the canonical hm:// URL with a version pin for
// a GetDocument call. Returns "" when we don't have enough info to key.
func documentTelemetryKey(account, path, version string) string {
	if account == "" {
		return ""
	}
	base := "hm://" + account
	if path != "" {
		if !strings.HasPrefix(path, "/") {
			base += "/"
		}
		base += path
	}
	if version != "" {
		base += "?v=" + version
	}
	return base
}

// accountTelemetryKey is the canonical key for a GetAccount call.
func accountTelemetryKey(uid string) string {
	if uid == "" {
		return ""
	}
	return "hm://" + uid
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	documents.RegisterDocumentsServer(rpc, srv)
	documents.RegisterAccessControlServer(rpc, srv)
	documents.RegisterCommentsServer(rpc, srv)
	documents.RegisterResourcesServer(rpc, srv)
}

// GetDocument implements Documents API v3.
func (srv *Server) GetDocument(ctx context.Context, in *documents.GetDocumentRequest) (*documents.Document, error) {
	{
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}
	}

	key := documentTelemetryKey(in.Account, in.Path, in.Version)
	srv.emitTelemetry(key, telemetry.StageGetDocumentRequestReceived)
	defer srv.emitTelemetry(key, telemetry.StageGetDocumentResponseSent)

	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, err
	}

	heads, err := docmodel.Version(in.Version).Parse()
	if err != nil {
		return nil, err
	}

	iri, err := makeIRI(ns, in.Path)
	if err != nil {
		return nil, err
	}

	// Try to answer from the hydration cache before doing any real work. Only
	// requests for the current version qualify -- see cachedDocument.
	if len(heads) == 0 {
		cached, ok, err := srv.cachedDocument(ctx, iri, ns, in.Path)
		if err != nil {
			return nil, err
		}
		if ok {
			return cached, nil
		}
	}

	doc, err := srv.loadDocument(ctx, ns, in.Path, heads, false)
	if err != nil {
		return nil, err
	}

	if doc.Visibility() == blob.VisibilityPrivate {
		if err := srv.denyPrivateDocument(ctx, ns, in.Path); err != nil {
			return nil, err
		}
	}

	return srv.hydrated.get(ctx, string(iri), doc)
}

// cachedDocument tries to answer a GetDocument for the current version straight
// from the hydration cache, without replaying the document's change log.
//
// The cache is keyed by the document's content-addressed version, and until now
// that version was only known after loadDocument had already replayed every
// change -- so even a cache hit paid the full cost, which the production profile
// showed as ~22% of all daemon CPU. The version is also sitting in the index,
// one indexed read away, and that same read carries the visibility we need for
// the private-document check.
//
// Only the current version takes this path. An explicit version may belong to
// an older generation, and visibility is a per-generation attribute, so serving
// one from here would risk applying the wrong generation's access rules.
//
// A miss is always safe: the caller falls through to the full load. A hit can't
// be stale either, because ResolveLatest reads the very document_generations row
// that IterChanges derives its replay set from -- if that row were behind, the
// full load would compute the same version anyway.
func (srv *Server) cachedDocument(ctx context.Context, iri blob.IRI, ns core.Principal, path string) (*documents.Document, bool, error) {
	state, err := srv.idx.ResolveLatest(ctx, iri)
	if err != nil {
		// Any failure here just means no shortcut. We deliberately swallow it
		// and fall through so the regular load stays responsible for every
		// error message, redirect detail and tombstone.
		return nil, false, nil //nolint:nilerr // Intentional: fall back to the slow path.
	}

	if state.Visibility == blob.VisibilityPrivate {
		if err := srv.denyPrivateDocument(ctx, ns, path); err != nil {
			return nil, false, err
		}
	}

	cached, ok := srv.hydrated.peek(hydrateCacheKey(string(iri), docmodel.NewVersion(state.Heads...).String()))

	return cached, ok, nil
}

// GetDocumentInfo implements Documents API v3.
func (srv *Server) GetDocumentInfo(ctx context.Context, in *documents.GetDocumentInfoRequest) (*documents.DocumentInfo, error) {
	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, err
	}

	info, err := sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (*documents.DocumentInfo, error) {
		lookup := blob.NewLookupCache(conn)
		iri, err := blob.NewIRI(ns, in.Path)
		if err != nil {
			return nil, err
		}
		return getDocumentInfo(conn, lookup, iri)
	})
	if err != nil {
		return nil, err
	}

	if info.Visibility == documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE {
		if err := srv.denyPrivateDocument(ctx, ns, in.Path); err != nil {
			return nil, err
		}
	}

	return info, nil
}

// BatchGetDocumentInfo implements Documents API v3.
func (srv *Server) BatchGetDocumentInfo(ctx context.Context, in *documents.BatchGetDocumentInfoRequest) (*documents.BatchGetDocumentInfoResponse, error) {
	if len(in.Requests) == 0 {
		return &documents.BatchGetDocumentInfoResponse{}, nil
	}

	visited := make(map[blob.IRI]struct{}, len(in.Requests))
	iris := make([]blob.IRI, len(in.Requests))
	{
		for i, req := range in.Requests {
			ns, err := core.DecodePrincipal(req.Account)
			if err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "failed to decode account %s: %v", req.Account, err)
			}

			iri, err := blob.NewIRI(ns, req.Path)
			if err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "failed to create IRI for account %s and path %s: %v", req.Account, req.Path, err)
			}
			if _, ok := visited[iri]; ok {
				return nil, status.Errorf(codes.InvalidArgument, "duplicate request for account %s and path %s", req.Account, req.Path)
			}
			visited[iri] = struct{}{}
			iris[i] = iri
		}
	}

	out := &documents.BatchGetDocumentInfoResponse{
		Documents: make([]*documents.DocumentInfo, len(in.Requests)),
	}
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		lookup := blob.NewLookupCache(conn)
		for i, iri := range iris {
			info, err := getDocumentInfo(conn, lookup, iri)
			if err != nil {
				return fmt.Errorf("failed to get document info for %s: %w", iri, err)
			}
			if info.Visibility == documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE {
				acc, path, err := iri.SpacePath()
				if err != nil {
					return err
				}
				if err := srv.denyPrivateDocument(ctx, acc, path); err != nil {
					return err
				}
			}
			out.Documents[i] = info
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// PrepareChange prepares unsigned Change and Ref blobs for client-side signing.
func (srv *Server) PrepareChange(ctx context.Context, in *documents.PrepareChangeRequest) (*documents.PrepareChangeResponse, error) {
	doc, err := srv.handleDocumentChangeRequest(ctx, documentChangeParams{
		Account:     in.Account,
		Path:        in.Path,
		BaseVersion: in.BaseVersion,
		Changes:     in.Changes,
		Capability:  in.Capability,
		Visibility:  in.Visibility,
	})
	if err != nil {
		return nil, err
	}

	// Use NopSigner to create the Change without actually signing it.
	// The client will sign it themselves.
	change, err := doc.CreateChange(blob.NewNopSigner(nil), time.Now())
	if err != nil {
		return nil, err
	}

	return &documents.PrepareChangeResponse{
		UnsignedChange: change.Data,
	}, nil
}

// documentChangeParams holds the common parameters for PrepareChange.
type documentChangeParams struct {
	Account     string
	Path        string
	BaseVersion string
	Changes     []*documents.DocumentChange
	Capability  string
	Visibility  documents.ResourceVisibility
}

// handleDocumentChangeRequest validates input, loads or creates the document, and applies the requested changes.
func (srv *Server) handleDocumentChangeRequest(ctx context.Context, in documentChangeParams) (*docmodel.Document, error) {
	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode account %s: %v", in.Account, err)
	}

	iri, err := makeIRI(ns, in.Path)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to make IRI from account=%s and path=%s: %v", in.Account, in.Path, err)
	}

	{
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}

		if len(in.Changes) == 0 {
			return nil, status.Errorf(codes.InvalidArgument, "at least one change is required")
		}

		if in.Visibility == documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE {
			if in.Path == "" {
				return nil, status.Errorf(codes.InvalidArgument, "root documents cannot be private")
			}

			if strings.Count(in.Path, "/") != 1 {
				return nil, status.Errorf(codes.InvalidArgument, "private documents must have a simple path with only a leading slash (e.g., '/document-name'): got %s", in.Path)
			}
		}

	}

	heads, err := docmodel.Version(in.BaseVersion).Parse()
	if err != nil {
		return nil, err
	}

	doc, err := srv.loadDocument(ctx, ns, in.Path, heads, true)
	if err != nil {
		if status.Code(err) != codes.FailedPrecondition {
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
		case in.Path == "" && doc.NumChanges() == 1:
		case in.Path != "" && doc.NumChanges() == 0:
		default:
			return nil, status.Errorf(codes.FailedPrecondition, "document with this path already exists, `base_version` is required for updating existing documents")
		}
	}

	if err := applyChanges(doc, in.Changes); err != nil {
		return nil, err
	}

	return doc, nil
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

		if publicOnly, err := srv.isPublicOnlyFor(ctx, ns, in.DirectoryPath); err != nil {
			return nil, err
		} else if publicOnly {
			qb.Where(publicOnlyListVisibilityFilter)
		}

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
			qb.Where("activity_time " + paginationCmp + " ?")
			args.Append(cursor.ActivityTime)

			qb.OrderBy("activity_time " + order)
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

	conn, release, err := srv.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	lookup := blob.NewLookupCache(conn)

	var count int32
	rows, discard, check := sqlitex.Query(conn, query, args...).All()
	defer discard(&err)

	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken = apiutil.EncodePageToken(cursor, nil)
			break
		}

		item, activityTime, err := documentInfoFromRow(lookup, row)
		if err != nil {
			return nil, err
		}

		count++

		cursor.ActivityTime = activityTime
		cursor.NameOrPath = item.Metadata.Fields["name"].GetStringValue()

		out.Documents = append(out.Documents, item)
	}
	if err := check(); err != nil {
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

	conn, release, err := srv.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	defer sqlitex.Save(conn)(&err)

	lookup := blob.NewLookupCache(conn)

	var count int32
	rows, discard, check := sqlitex.Query(conn, query, args...).All()
	defer discard(&err)
	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken = apiutil.EncodePageToken(cursor, nil)
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
	if err := check(); err != nil {
		return nil, err
	}

	// Now for each account in the list we need to load their home document info.
	// TODO(burdiyan): this is far from idea. We should find a better way to do it.

	for _, acc := range out.Accounts {
		iri := blob.IRI("hm://" + acc.Id)
		acc.HomeDocumentInfo, err = getDocumentInfo(conn, lookup, iri)
		if err != nil && status.Code(err) != codes.NotFound {
			return nil, fmt.Errorf("failed to load home document info for account %s: %v", acc.Id, err)
		}
	}

	return out, nil
}

// GetAccount implements Documents API v3.
func (srv *Server) GetAccount(ctx context.Context, in *documents.GetAccountRequest) (*documents.Account, error) {
	{
		if in.Id == "" {
			return nil, errutil.MissingArgument("account")
		}
	}

	key := accountTelemetryKey(in.Id)
	srv.emitTelemetry(key, telemetry.StageGetAccountRequestReceived)
	defer srv.emitTelemetry(key, telemetry.StageGetAccountResponseSent)

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (*documents.Account, error) {
		lookup := blob.NewLookupCache(conn)
		return srv.getAccountByID(conn, lookup, in.Id)
	})
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

	conn, release, err := srv.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	defer sqlitex.Save(conn)(&err)

	lookup := blob.NewLookupCache(conn)

	slices.Sort(in.Ids)
	in.Ids = slices.Compact(in.Ids)

	for _, id := range in.Ids {
		acc, err := srv.getAccountByID(conn, lookup, id)
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
			`(
	SELECT
		json_group_array(json_object(
			'ts', ts,
			'profile', json(extra_attrs)
		))
	FROM (
        SELECT
        	*,
            ROW_NUMBER() OVER (PARTITION BY resource, author ORDER BY ts DESC) AS rn
		FROM structural_blobs
		WHERE resource = (SELECT id FROM resources WHERE iri = 'hm://' || spaces.id)
		AND type = 'Profile'
		AND extra_attrs IS NOT NULL
	) ranked
	WHERE rn = 1
	GROUP BY resource
) AS profiles`,
		).
		From("spaces").
		LeftJoin("(SELECT DISTINCT substr(iri, 6, 48) AS id FROM subscriptions) subs", "spaces.id = subs.id")
}

func (srv *Server) getAccountByID(conn *sqlite.Conn, lookup *blob.LookupCache, id string) (out *documents.Account, err error) {
	acc, err := core.DecodePrincipal(id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode account %s: %v", id, err)
	}

	qb := srv.baseAccountQuery()
	qb = qb.Where("spaces.id = ?")

	rows, discard, check := sqlitex.Query(conn, qb.String(), id).All()
	defer discard(&err)
	for row := range rows {
		item, err := srv.accountFromRow(row, lookup)
		if err != nil {
			return nil, err
		}
		out = item.Proto
		break
	}
	if err := check(); err != nil {
		return nil, err
	}

	if out == nil {
		return nil, status.Errorf(codes.NotFound, "account %s is not found", id)
	}

	iri, err := blob.NewIRI(acc, "")
	if err != nil {
		return nil, err
	}

	info, err := getDocumentInfo(conn, lookup, iri)
	if err != nil {
		// If the error is not found we handle it gracefully,
		// and simply won't set the home document info.
		if status.Code(err) != codes.NotFound {
			return nil, err
		}
	} else {
		out.HomeDocumentInfo = info
	}

	return out, nil
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
		profilesJSON     = row.ColumnBytesUnsafe(seq())
	)

	var attrs blob.DocIndexedAttrs
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &attrs); err != nil {
			srv.log.Warn("Unmarshal error", zap.Any("metadataJSON", metadataJSON), zap.Error(err))
		}
	}

	metadata := attrs.PublicMap()

	var (
		latestCommentID   string
		latestCommentTime *timestamppb.Timestamp
	)
	if lastCommentID != 0 {
		lc, err := lookup.CID(lastCommentID)
		if err != nil {
			return nil, fmt.Errorf("accountFromRow: %w", err)
		}

		rid, err := lookup.RecordID(lc)
		if err != nil {
			return nil, fmt.Errorf("accountFromRow: %w", err)
		}

		latestCommentID = rid.String()
		latestCommentTime = timestamppb.New(time.UnixMilli(lastCommentTime))
	}

	metastruct, err := structpb.NewStruct(metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to collect struct metadata: %w", err)
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
	}

	if len(profilesJSON) > 0 {
		profile := lwwmap.New()

		var profiles []dbProfile

		if err := json.Unmarshal(profilesJSON, &profiles); err != nil {
			return nil, fmt.Errorf("failed to unmarshal profiles: %w", err)
		}

		for _, p := range profiles {
			if p.Profile.Alias > 0 {
				profile.Set(p.Ts, []string{"alias"}, p.Profile.Alias)
			}

			if p.Profile.Name != "" {
				profile.Set(p.Ts, []string{"name"}, p.Profile.Name)
			}

			if p.Profile.Icon != "" {
				profile.Set(p.Ts, []string{"icon"}, p.Profile.Icon)
			}

			if p.Profile.Description != "" {
				profile.Set(p.Ts, []string{"description"}, p.Profile.Description)
			}
		}

		// If we have alias we ignore all the other profile fields.
		aliasID, ok := profile.Get([]string{"alias"})
		if ok {
			alias, err := lookup.PublicKey(aliasID.(int64))
			if err != nil {
				return nil, fmt.Errorf("failed to lookup alias: %w", err)
			}
			item.AliasAccount = alias.String()
		} else {
			item.Profile = &documents.Profile{}

			name, ok := profile.Get([]string{"name"})
			if ok {
				item.Profile.Name = name.(string)
			}

			icon, ok := profile.Get([]string{"icon"})
			if ok {
				item.Profile.Icon = icon.(string)
			}

			description, ok := profile.Get([]string{"description"})
			if ok {
				item.Profile.Description = description.(string)
			}

			item.Profile.UpdateTime = timestamppb.New(time.UnixMilli(profile.MaxTS()))
		}
	}

	return &dbAccount{
		Proto:            item,
		SpaceID:          spaceID,
		LastActivityTime: lastActivityTime,
	}, nil
}

type dbProfile struct {
	Ts      int64 `json:"ts"`
	Profile struct {
		Alias       int64  `json:"alias"`
		Name        string `json:"name"`
		Icon        string `json:"icon"`
		Description string `json:"description"`
	}
}

type profileJSON struct {
	Ts      int64          `json:"ts"`
	Profile map[string]any `json:"profile"`
}

// UpdateProfile implements Documents API v3.
func (srv *Server) UpdateProfile(ctx context.Context, in *documents.UpdateProfileRequest) (*documents.Account, error) {
	if err := validation.ValidateStruct(in,
		validation.Field(&in.Account, validation.Required),
		validation.Field(&in.Profile, validation.Required),
		validation.Field(&in.SigningKeyName, validation.Required),
	); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}

	acc, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, err
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	if err := srv.checkWriteAccess(ctx, acc, "", kp); err != nil {
		return nil, err
	}

	sb, err := blob.NewProfile(kp, in.Profile.Name, blob.URI(in.Profile.Icon), in.Profile.Description, acc, cclock.New().MustNow())
	if err != nil {
		return nil, err
	}

	if err := srv.idx.Put(ctx, sb); err != nil {
		return nil, fmt.Errorf("failed to save profile blob: %w", err)
	}

	out, err := srv.GetAccount(ctx, &documents.GetAccountRequest{
		Id: in.Account,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "can't load account after updating the profile: %v", err)
	}

	return out, nil
}

// ListRootDocuments implements Documents API v3.
func (srv *Server) ListRootDocuments(ctx context.Context, in *documents.ListRootDocumentsRequest) (out *documents.ListRootDocumentsResponse, err error) {
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

	out = &documents.ListRootDocumentsResponse{
		Documents: make([]*documents.DocumentInfo, 0, min(in.PageSize, maxPageAllocBuffer)),
	}

	var (
		query string
		args  colx.Slice[any]
	)
	{
		qb := baseListDocumentsQuery().OrderBy("activity_time DESC")

		srv.applyListVisibilityFilter(ctx, qb, &args)

		qb.Where("r.iri GLOB 'hm://*'")
		qb.Where("r.iri NOT GLOB 'hm://*/*'")

		qb.Where("activity_time < ?", "r.iri < ?")
		args.Append(cursor.ActivityTime, cursor.IRI)

		args.Append(in.PageSize)
		query = qb.String()
	}

	conn, release, err := srv.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	lookup := blob.NewLookupCache(conn)

	var count int32
	rows, discard, check := sqlitex.Query(conn, query, args...).All()
	defer discard(&err)

	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken = apiutil.EncodePageToken(cursor, nil)
			break
		}

		item, activityTime, err := documentInfoFromRow(lookup, row)
		if err != nil {
			return nil, err
		}

		count++

		cursor.ActivityTime = activityTime
		cursor.IRI = "hm://" + item.Account + "/" + item.Path
		cursor.IRI = strings.TrimSuffix(cursor.IRI, "/")

		out.Documents = append(out.Documents, item)
	}

	if err := check(); err != nil {
		return nil, err
	}

	return out, nil
}

// ListDocuments implements Documents API v3.
func (srv *Server) ListDocuments(ctx context.Context, in *documents.ListDocumentsRequest) (out *documents.ListDocumentsResponse, err error) {
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

	out = &documents.ListDocumentsResponse{
		Documents: make([]*documents.DocumentInfo, 0, min(in.PageSize, maxPageAllocBuffer)),
	}

	var (
		query string
		args  colx.Slice[any]
	)
	{
		qb := baseListDocumentsQuery().OrderBy("activity_time DESC")

		if in.Account == "" {
			srv.applyListVisibilityFilter(ctx, qb, &args)
			qb.Where("r.iri GLOB 'hm://*'")
		} else {
			ns, err := core.DecodePrincipal(in.Account)
			if err != nil {
				return nil, fmt.Errorf("failed to decode account: %w", err)
			}
			if publicOnly, err := srv.isPublicOnlyFor(ctx, ns, ""); err != nil {
				return nil, err
			} else if publicOnly {
				qb.Where(publicOnlyListVisibilityFilter)
			}

			iri, err := blob.NewIRI(ns, "")
			if err != nil {
				return nil, err
			}

			qb.Where("(r.iri = ? OR r.iri GLOB ?)")
			args.Append(iri, iri+"/*")
		}

		qb.Where("activity_time < ?", "r.iri < ?")
		args.Append(cursor.ActivityTime, cursor.IRI)

		args.Append(in.PageSize)
		query = qb.String()
	}

	conn, release, err := srv.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	lookup := blob.NewLookupCache(conn)

	var count int32
	rows, discard, check := sqlitex.Query(conn, query, args...).All()
	defer discard(&err)
	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken = apiutil.EncodePageToken(cursor, nil)
			break
		}

		item, activityTime, err := documentInfoFromRow(lookup, row)
		if err != nil {
			return nil, err
		}

		count++

		cursor.ActivityTime = activityTime
		cursor.IRI = "hm://" + item.Account + "/" + item.Path
		cursor.IRI = strings.TrimSuffix(cursor.IRI, "/")

		out.Documents = append(out.Documents, item)
	}

	if err := check(); err != nil {
		return nil, err
	}

	return out, nil
}

func getDocumentInfo(conn *sqlite.Conn, lookup *blob.LookupCache, iri blob.IRI) (info *documents.DocumentInfo, err error) {
	q := baseSingleDocumentQuery().Where("r.iri = ?").String()
	// The IRI is bound twice: as the comment aggregation seed, and as the row filter.
	// 0 is the page size parameter.
	rows, discard, check := sqlitex.Query(conn, q, iri, iri, 0).All()
	defer discard(&err)

	for row := range rows {
		info, _, err := documentInfoFromRow(lookup, row)
		return info, err
	}

	if err := check(); err != nil {
		return nil, err
	}

	return nil, status.Errorf(codes.NotFound, "document with IRI %s is not found", iri)
}

// qListDocsCommentAgg computes each document's comment activity (count, latest comment)
// directly from the indexed Comment blobs, deduplicating edits by TSID and dropping
// deleted comments, and credits every comment both to the resource it targets and to
// all transitive redirect targets of that resource.
//
// It exists because comment blobs record the document path as it was when the comment
// was written: after a document moves, its comments stay attached to the old path's
// resource, and the incrementally-maintained document_generations.comment_count of the
// new path's resource knows nothing about them. Deriving the stats from the blobs at
// query time keeps listings consistent with what ListComments actually returns for the
// document (which walks the same redirect relation backwards via redirectAncestorsCTE),
// no matter in which order the blobs arrived.
//
// The recursion is seeded only with the (few) redirecting resources, so every step is
// an indexed lookup, and it's cheap even on big databases.
const qListDocsCommentAgg = `(
	WITH RECURSIVE
	redirected AS (
		SELECT
			dg.resource AS resource,
			dg.metadata->>'$."$db.redirect".v' AS redirect_iri
		FROM document_generations dg
		WHERE dg.metadata->>'$."$db.redirect".v' IS NOT NULL
		AND dg.generation = (SELECT MAX(g.generation) FROM document_generations g WHERE g.resource = dg.resource)
	),
	chains(source, target_iri, depth) AS (
		SELECT rd.resource, rd.redirect_iri, 0 FROM redirected rd
		UNION ALL
		SELECT c.source, rd.redirect_iri, c.depth + 1
		FROM chains c
		JOIN resources tr ON tr.iri = c.target_iri
		JOIN redirected rd ON rd.resource = tr.id
		WHERE c.depth < 16 AND rd.redirect_iri != c.target_iri
	),
	credits AS (
		SELECT DISTINCT c.source, tr.id AS target
		FROM chains c
		JOIN resources tr ON tr.iri = c.target_iri
		WHERE tr.id != c.source
	),
	deduped AS (
		SELECT
			sb.resource AS resource,
			sb.id AS id,
			sb.ts AS ts,
			ROW_NUMBER() OVER (PARTITION BY sb.extra_attrs->>'tsid' ORDER BY sb.ts DESC, sb.id DESC) AS rn,
			sb.extra_attrs->>'deleted' AS deleted
		FROM structural_blobs sb
		WHERE sb.type = 'Comment'
	),
	live AS (
		SELECT resource, id, ts FROM deduped WHERE rn = 1 AND deleted IS NULL
	),
	credited AS (
		SELECT l.resource AS resource, l.id, l.ts FROM live l
		UNION ALL
		SELECT cr.target, l.id, l.ts FROM live l JOIN credits cr ON cr.source = l.resource
	),
	totals AS (
		SELECT resource, COUNT(*) AS comment_count FROM credited GROUP BY resource
	),
	latest AS (
		SELECT resource, MAX(ts) AS last_comment_time, id AS last_comment FROM credited GROUP BY resource
	)
	SELECT t.resource AS resource, t.comment_count, l.last_comment_time, l.last_comment
	FROM totals t
	JOIN latest l ON l.resource = t.resource
) agg`

// qSingleDocCommentAgg is the single-document counterpart of qListDocsCommentAgg.
// Instead of aggregating comment activity for every document, it walks the redirect
// chain backwards from one IRI (bound as the subquery's parameter, same as the outer
// r.iri filter), exactly like ListComments' redirectAncestorsCTE, and only touches
// that document's comments. Point lookups like GetDocumentInfo (which gets called in
// loops by BatchGetDocumentInfo and for accounts' home documents) must use this
// instead of paying for the global aggregation.
const qSingleDocCommentAgg = `(
	WITH RECURSIVE
	redirect_ancestors(resource, iri, depth) AS (
		SELECT r.id, r.iri, 0 FROM resources r WHERE r.iri = ?

		UNION ALL

		SELECT dg.resource, res.iri, ra.depth + 1
		FROM redirect_ancestors ra
		JOIN document_generations dg ON dg.metadata->>'$."$db.redirect".v' = ra.iri
		JOIN resources res ON res.id = dg.resource
		WHERE dg.generation = (SELECT MAX(g.generation) FROM document_generations g WHERE g.resource = dg.resource)
		AND res.iri != ra.iri
		AND ra.depth < 16
	),
	deduped AS (
		SELECT
			sb.id AS id,
			sb.ts AS ts,
			ROW_NUMBER() OVER (PARTITION BY sb.extra_attrs->>'tsid' ORDER BY sb.ts DESC, sb.id DESC) AS rn,
			sb.extra_attrs->>'deleted' AS deleted
		FROM structural_blobs sb
		WHERE sb.type = 'Comment'
		AND sb.resource IN (SELECT resource FROM redirect_ancestors)
	),
	live AS (
		SELECT id, ts FROM deduped WHERE rn = 1 AND deleted IS NULL
	),
	totals AS (
		SELECT COUNT(*) AS comment_count FROM live
	),
	latest AS (
		SELECT MAX(ts) AS last_comment_time, id AS last_comment FROM live
	)
	SELECT
		(SELECT resource FROM redirect_ancestors WHERE depth = 0) AS resource,
		t.comment_count,
		l.last_comment_time,
		l.last_comment
	FROM totals t, latest l
) agg`

func baseListDocumentsQuery() *dqb.SelectQuery {
	return baseDocumentsQuery(qListDocsCommentAgg)
}

func baseSingleDocumentQuery() *dqb.SelectQuery {
	return baseDocumentsQuery(qSingleDocCommentAgg)
}

func baseDocumentsQuery(commentAggJoin string) *dqb.SelectQuery {
	// Page size must be the last binding parameter.
	return dqb.
		Select(
			"r.iri",
			"dg.genesis",
			"dg.generation",
			"dg.metadata",
			"COALESCE(agg.comment_count, 0) AS comment_count",
			"dg.heads",
			"dg.authors",
			"dg.genesis_change_time",
			"agg.last_comment",
			"COALESCE(agg.last_comment_time, 0) AS last_comment_time",
			"dg.last_change_time",
			// Redirect-aware activity timestamp. Sorting and pagination must use this
			// instead of dg.last_activity_time, which misses comments made on the
			// document's previous paths.
			"MAX(COALESCE(agg.last_comment_time, 0), dg.last_alive_ref_time) AS activity_time",
			"(SELECT 1 FROM unread_resources WHERE iri = r.iri) AS is_unread",
			// Alive direct children of the document, so listing cards can show
			// the subdocument count without a per-document interaction-summary
			// request. The prefix-range comparison (everything between
			// 'iri/' and 'iri0', '0' being the character after '/') seeks the
			// resources.iri index instead of scanning; the instr check drops
			// grandchildren; the innermost subquery keeps only resources whose
			// latest generation is alive.
			`(SELECT count(*)
			  FROM resources cr
			  WHERE cr.iri > r.iri || '/' AND cr.iri < r.iri || '0'
			    AND instr(substr(cr.iri, length(r.iri) + 2), '/') = 0
			    AND (SELECT cdg.is_deleted FROM document_generations cdg WHERE cdg.resource = cr.id ORDER BY cdg.generation DESC LIMIT 1) = 0
			) AS children_count`,
		).
		From(
			"document_generations dg",
			"resources r",
		).
		LeftJoin(commentAggJoin, "agg.resource = dg.resource").
		Where("r.id = dg.resource").
		GroupBy("dg.resource HAVING dg.generation = MAX(dg.generation) AND dg.is_deleted = 0").
		Limit("? + 1")
}

// documentInfoFromRow decodes a row of the base documents query.
// Alongside the document info it returns the row's activity timestamp
// (the redirect-aware activity_time column): callers that paginate by
// activity MUST use it for their page cursors, because it's the same
// value the query sorts and filters by.
func documentInfoFromRow(lookup *blob.LookupCache, row *sqlite.Stmt) (*documents.DocumentInfo, int64, error) {
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
		activityTime      = row.ColumnInt64(inc())
		isUnread          = row.ColumnInt64(inc()) > 0
		childrenCount     = row.ColumnInt64(inc())
	)

	iri := blob.IRI(iriRaw)
	space, path, err := iri.SpacePath()
	if err != nil {
		return nil, 0, err
	}

	var attrs blob.DocIndexedAttrs
	if err := json.Unmarshal(metadataJSON, &attrs); err != nil {
		return nil, 0, err
	}

	metadata := attrs.PublicMap()

	var redirectInfo *documents.RefTarget_Redirect
	if redirect, ok := attrs["$db.redirect"]; ok {
		space, path, err := blob.IRI(redirect.Value.(string)).SpacePath()
		if err != nil {
			return nil, 0, fmt.Errorf("failed to parse redirect target %v: %w", redirect.Value, err)
		}
		redirectInfo = &documents.RefTarget_Redirect{
			Account:   space.String(),
			Path:      path,
			Republish: true,
		}
	}

	// Derived fallback cover image, stored under an internal "$db." key (so it
	// never leaks into the user-authored metadata map) and exposed as a typed
	// sibling field. Field presence distinguishes "not derived yet" from
	// "derived: the document has no content image" (empty string).
	var firstImageInContent *string
	if v, ok := attrs[blob.FirstImageInContentAttr]; ok {
		if s, isStr := v.Value.(string); isStr {
			firstImageInContent = &s
		}
	}

	var authorIDs []int64
	if err := json.Unmarshal(authorsJSON, &authorIDs); err != nil {
		return nil, 0, err
	}

	authors := make([]string, len(authorIDs))
	for i, a := range authorIDs {
		aa, err := lookup.PublicKey(a)
		if err != nil {
			return nil, 0, err
		}
		authors[i] = aa.String()
	}

	var headIDs []int64
	if err := json.Unmarshal(headsJSON, &headIDs); err != nil {
		return nil, 0, err
	}

	cids := make([]cid.Cid, len(headIDs))
	for i, h := range headIDs {
		cids[i], err = lookup.CID(h)
		if err != nil {
			return nil, 0, err
		}
	}

	crumbIRIs := iri.Breadcrumbs()
	crumbIRIs = crumbIRIs[:len(crumbIRIs)-1] // Minus 1 to skip the current document.

	var crumbs []*documents.Breadcrumb
	if len(crumbIRIs) > 0 {
		crumbs = make([]*documents.Breadcrumb, len(crumbIRIs))

		for i, iri := range crumbIRIs { // Minus one to skip the current document
			title, found, err := lookup.DocumentTitle(iri)
			if err != nil {
				return nil, 0, err
			}

			_, path, err := iri.SpacePath()
			if err != nil {
				return nil, 0, err
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
			return nil, 0, err
		}

		rid, err := lookup.RecordID(lc)
		if err != nil {
			return nil, 0, err
		}

		latestComment = rid.String()
		latestCommentTime = timestamppb.New(time.UnixMilli(lastCommentTime))
	}

	metastruct, err := structpb.NewStruct(metadata)
	if err != nil {
		return nil, 0, err
	}

	out := &documents.DocumentInfo{
		Account:             space.String(),
		Path:                path,
		Metadata:            metastruct,
		FirstImageInContent: firstImageInContent,
		Authors:             authors,
		CreateTime:          timestamppb.New(time.UnixMilli(genesisChangeTime)),
		UpdateTime:          timestamppb.New(time.UnixMilli(lastChangeTime)),
		Genesis:             genesis,
		Version:             blob.NewVersion(cids...).String(),
		Breadcrumbs:         crumbs,
		ActivitySummary: &documents.ActivitySummary{
			CommentCount:      int32(commentCount), //nolint:gosec
			LatestCommentId:   latestComment,
			LatestCommentTime: latestCommentTime,
			LatestChangeTime:  timestamppb.New(time.UnixMilli(lastChangeTime)),
			IsUnread:          isUnread,
			ChildrenCount:     int32(childrenCount), //nolint:gosec
		},
		GenerationInfo: &documents.GenerationInfo{
			Genesis:    genesis,
			Generation: generation,
		},
		RedirectInfo: redirectInfo,
		Visibility:   documents.ResourceVisibility_RESOURCE_VISIBILITY_PUBLIC,
	}

	if v, ok := attrs["$db.visibility"]; ok {
		out.Visibility = docmodel.VisibilityToProto(blob.Visibility(v.Value.(string)))
	}

	return out, activityTime, nil
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

		doc, err := srv.loadDocumentInfo(ctx, ns, in.Path)
		if err != nil && status.Code(err) != codes.NotFound {
			return nil, err
		}

		if doc != nil && in.Generation == 0 {
			in.Generation = doc.GenerationInfo.Generation
		}

		// If there's an existing document, we want to make sure the genesis of the ref we are creating is the same.
		if doc != nil {
			if doc.Genesis != rt.Version.Genesis && in.Generation <= doc.GenerationInfo.Generation {
				return nil, status.Errorf(codes.FailedPrecondition, "There's already a Ref for this path with a different genesis. Provide an explicit generation number higher than %d to overwrite.", doc.GenerationInfo.Generation)
			}
		}

		refBlob, err = blob.NewRef(kp, in.Generation, genesis, ns, in.Path, heads, ts, blob.VisibilityPublic)
		if err != nil {
			return nil, err
		}
	case *documents.RefTarget_Tombstone_:
		doc, err := srv.loadDocumentInfo(ctx, ns, in.Path)
		if err != nil {
			return nil, err
		}

		if doc != nil && in.Generation == 0 {
			in.Generation = doc.GenerationInfo.Generation
		}

		genesis, err := cid.Decode(doc.Genesis)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to parse genesis: %v", err)
		}

		refBlob, err = blob.NewRef(kp, in.Generation, genesis, ns, in.Path, nil, ts, blob.VisibilityPublic)
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

		if in.Generation == 0 {
			clock := cclock.New()
			in.Generation = clock.MustNow().UnixMilli()
		}

		if _, err := blob.NewIRI(targetSpace, rt.Redirect.Path); err != nil {
			return nil, err
		}

		doc, err := srv.loadDocumentInfo(ctx, targetSpace, rt.Redirect.Path)
		if err != nil {
			return nil, err
		}

		if doc != nil && in.Generation == 0 {
			in.Generation = doc.GenerationInfo.Generation
		}

		genesis, err := cid.Decode(doc.Genesis)
		if err != nil {
			return nil, err
		}

		target := blob.RedirectTarget{
			Space:     targetSpace,
			Path:      rt.Redirect.Path,
			Republish: rt.Redirect.Republish,
		}

		refBlob, err = blob.NewRefRedirect(kp, in.Generation, genesis, ns, in.Path, target, ts)
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

	if ref.Value.Visibility == blob.VisibilityPrivate {
		if err := srv.denyPrivateDocument(ctx, ref.Value.Space(), ref.Value.Path); err != nil {
			return nil, err
		}
	}

	return refToProto(ref.CID, ref.Value)
}

// ListRefs implements Documents API v3.
func (srv *Server) ListRefs(ctx context.Context, in *documents.ListRefsRequest) (*documents.ListRefsResponse, error) {
	if in.Account == "" {
		return nil, errutil.MissingArgument("account")
	}

	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, err
	}

	iri, err := blob.NewIRI(ns, in.Path)
	if err != nil {
		return nil, err
	}

	var refCIDs []cid.Cid
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) (err error) {
		rows, discard, check := sqlitex.Query(conn, qListRefsForDocument(), iri).All()
		defer discard(&err)

		for row := range rows {
			codec := row.ColumnInt64(0)
			hash := row.ColumnBytes(1)
			refCIDs = append(refCIDs, cid.NewCidV1(uint64(codec), hash))
		}

		if err := check(); err != nil {
			return err
		}

		return nil
	}); err != nil {
		return nil, err
	}

	out := &documents.ListRefsResponse{Refs: make([]*documents.Ref, 0, len(refCIDs))}
	for _, c := range refCIDs {
		ref, err := srv.getRef(ctx, c)
		if err != nil {
			return nil, err
		}

		if ref.Value.Visibility == blob.VisibilityPrivate {
			if err := srv.denyPrivateDocument(ctx, ref.Value.Space(), ref.Value.Path); err != nil {
				continue
			}
		}

		pb, err := refToProto(ref.CID, ref.Value)
		if err != nil {
			return nil, err
		}

		out.Refs = append(out.Refs, pb)
	}

	return out, nil
}

var qListRefsForDocument = dqb.Str(`
	SELECT b.codec, b.multihash
	FROM structural_blobs sb
	JOIN resources r ON r.id = sb.resource
	JOIN blobs b ON b.id = sb.id
	WHERE sb.type = 'Ref'
	AND r.iri = ?
	ORDER BY CAST(COALESCE(sb.extra_attrs->>'generation', '0') AS INTEGER) DESC, sb.ts DESC, sb.id DESC
`)

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

	ebr, err := blob.NewRef(kp, 0, ebc.CID, space, path, []cid.Cid{ebc.CID}, blob.ZeroUnixTime(), blob.VisibilityPublic)
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

func (srv *Server) loadDocumentInfo(ctx context.Context, account core.Principal, path string) (*documents.DocumentInfo, error) {
	iri, err := blob.NewIRI(account, path)
	if err != nil {
		return nil, err
	}

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) (*documents.DocumentInfo, error) {
		lookup := blob.NewLookupCache(conn)
		return getDocumentInfo(conn, lookup, iri)
	})
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
		doc.SetVisibility(ch.Visibility)
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

func (srv *Server) applyListVisibilityFilter(ctx context.Context, qb *dqb.SelectQuery, args *colx.Slice[any]) {
	if !srv.cfg.PublicOnly {
		return
	}
	if caller, ok := blob.GetAuthenticatedCaller(ctx); ok {
		qb.Where(authenticatedListVisibilityFilter)
		args.Append([]byte(caller))
		return
	}
	qb.Where(publicOnlyListVisibilityFilter)
}

func (srv *Server) canReadPrivate(ctx context.Context, account core.Principal, path string) (bool, error) {
	if !srv.cfg.PublicOnly {
		return true, nil
	}

	caller, ok := blob.GetAuthenticatedCaller(ctx)
	if !ok {
		return false, nil
	}

	return srv.idx.IsValidWriter(ctx, account, "", caller)
}

func (srv *Server) isPublicOnlyFor(ctx context.Context, account core.Principal, path string) (bool, error) {
	if !srv.cfg.PublicOnly {
		return false, nil
	}

	ok, err := srv.canReadPrivate(ctx, account, path)
	return !ok, err
}

func (srv *Server) denyPrivateDocument(ctx context.Context, account core.Principal, path string) error {
	publicOnly, err := srv.isPublicOnlyFor(ctx, account, path)
	if err != nil {
		return err
	}
	if publicOnly {
		return status.Errorf(codes.PermissionDenied, "access to private documents is not allowed")
	}
	return nil
}

func (srv *Server) denyPrivateComment(ctx context.Context, account core.Principal, path string) error {
	publicOnly, err := srv.isPublicOnlyFor(ctx, account, path)
	if err != nil {
		return err
	}
	if publicOnly {
		return status.Errorf(codes.PermissionDenied, "access to private comments is not allowed")
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
		Visibility:     doc.Visibility,
	}
}
