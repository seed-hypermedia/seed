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
	"seed/backend/util/attrkey"
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
	maxPageSize                    = 2000 // Hard cap on client-requested page sizes; clients wanting more must follow next_page_token.
	maxPageAllocBuffer             = 400  // Arbitrary limit to prevent allocating too much memory when client requested huge page size.
	maxQueryDocumentsPageSize      = 1000
	maxQueryDocumentSorts          = 16
	publicOnlyListVisibilityFilter = `dg.visibility IS NOT 'Private'`
	indexedAttributeString         = "s"
	indexedAttributeBool           = "b"
	indexedAttributeInt            = "i"
)

var authenticatedListVisibilityFilter = `(
	dg.visibility IS NOT 'Private'
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

	// Let the indexer derive the document-level fields at index time, reusing
	// the real docmodel so the results match what the read path renders. This is
	// how the derived cover and collection fields get populated. The daemon also
	// wires this earlier (before the backfill reindex task starts); this keeps
	// embedders and tests that construct the server directly working.
	idx.SetDeriveDocFields(DeriveDocFields)

	return srv
}

// clampPageSize applies the default page size when the client didn't set one,
// and caps huge page sizes: clients wanting more data must follow next_page_token.
// The proto contract explicitly allows the server to ignore the requested size.
func (srv *Server) clampPageSize(rpc string, pageSize *int32, defaultSize int32) {
	if *pageSize <= 0 {
		*pageSize = defaultSize
		return
	}
	if *pageSize > maxPageSize {
		srv.log.Warn("PageSizeClamped", zap.String("rpc", rpc), zap.Int32("requestedPageSize", *pageSize))
		*pageSize = maxPageSize
	}
}

// DeriveDocFields rebuilds a document in memory from the given changes and
// returns the fields the indexer derives from a document's full history: the
// link of the first image block in reading order, and whether the document is a
// collection. It's injected into the indexer (SetDeriveDocFields) to populate
// DocumentInfo.first_image_in_content and DocumentInfo.is_collection, letting
// directory cards render a fallback cover and the file browser mark collections
// from fast metadata instead of fetching each child's full document. It's a
// pure function so the daemon can wire it before the migration-triggered
// backfill reindex starts, long before this server exists.
//
// Both fields come out of one replay on purpose: rebuilding the model is the
// entire cost, and each field is then a walk over a tree that already exists.
//
// The changes are supplied by the indexer (already loaded on its transaction's
// connection), so this does no database I/O and is safe to call mid-indexing.
// It mirrors loadDocument's in-memory build but never touches the pool.
func DeriveDocFields(iri blob.IRI, changes []blob.ChangeRecord) (fields blob.DerivedDocFields, err error) {
	// The docmodel panics on changes it considers impossible, but such changes
	// exist in the wild: a single move op with ~5.8k+ blocks overflows the op ID
	// index (the apply loop advances idx quadratically), which panics ApplyChange.
	// The indexer calls this for every document Ref — including the boot-time
	// backfill reindex — so an unrecovered panic crash-loops the whole daemon on
	// one bad blob. Turn panics into errors: the caller logs them and records the
	// zero value, which clients handle by falling back to a content fetch.
	defer func() {
		if r := recover(); r != nil {
			fields = blob.DerivedDocFields{}
			err = fmt.Errorf("panic while deriving document fields for %s: %v", iri, r)
		}
	}()

	if len(changes) == 0 {
		return blob.DerivedDocFields{}, nil
	}

	doc, err := docmodel.New(iri, cclock.New())
	if err != nil {
		return blob.DerivedDocFields{}, err
	}

	for _, ch := range changes {
		doc.SetVisibility(ch.Visibility)
		if !doc.Generation.IsSet() {
			doc.Generation = maybe.New(ch.Generation)
		}
		if err := doc.ApplyChange(ch.CID, ch.Data); err != nil {
			return blob.DerivedDocFields{}, err
		}
	}

	return blob.DerivedDocFields{
		FirstImage:   doc.FirstContentImage(),
		IsCollection: doc.IsCollection(),
	}, nil
}

// SetTelemetry wires the journeys profiler. Optional; when nil, all
// telemetry emitters are no-ops.
func (srv *Server) SetTelemetry(t *telemetry.Server) {
	srv.telemetry = t
}

// QueryDocuments queries current document attributes.
func (srv *Server) QueryDocuments(ctx context.Context, in *documents.QueryDocumentsRequest) (out *documents.QueryDocumentsResponse, err error) {
	if in.PageSize <= 0 {
		in.PageSize = defaultPageSize
	}
	if in.PageSize > maxQueryDocumentsPageSize {
		return nil, status.Errorf(codes.InvalidArgument, "page_size must not exceed %d", maxQueryDocumentsPageSize)
	}

	cursor := struct {
		Offset int `json:"o"`
	}{}
	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &cursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	args := colx.Slice[any]{}
	qb := baseListDocumentsQuery(commentAggAll)
	qb.Where("r.iri GLOB 'hm://*'")
	whereFilters, havingFilter := splitDocumentLocationFilters(in.GetFilter())
	for _, locationFilter := range whereFilters {
		where, err := documentFilterSQL(locationFilter, &args, 0)
		if err != nil {
			return nil, err
		}
		qb.Where(where)
	}
	srv.applyListVisibilityFilter(ctx, qb, &args)
	filterArgs := colx.Slice[any]{}
	filter, err := documentFilterSQL(havingFilter, &filterArgs, 0)
	if err != nil {
		return nil, err
	}
	qb.Having(filter)
	args.Append(filterArgs...)

	order, err := documentSortSQL(in.GetSort(), &args)
	if err != nil {
		return nil, err
	}
	qb.OrderBy(order).Limit("? OFFSET ?")
	args.Append(in.PageSize+1, cursor.Offset)

	out = &documents.QueryDocumentsResponse{
		Documents: make([]*documents.DocumentInfo, 0, min(in.PageSize, maxPageAllocBuffer)),
	}
	conn, release, err := srv.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	lookup := blob.NewLookupCache(conn)
	err = sqlitex.ExecTransient(conn, qb.StringTransient(), func(row *sqlite.Stmt) error {
		if len(out.Documents) == int(in.PageSize) {
			out.NextPageToken = apiutil.EncodePageToken(struct {
				Offset int `json:"o"`
			}{Offset: cursor.Offset + len(out.Documents)}, nil)
			return nil
		}
		item, _, err := documentInfoFromRow(lookup, row)
		if err != nil {
			return err
		}
		out.Documents = append(out.Documents, item)
		return nil
	}, args...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// splitDocumentLocationFilters moves top-level location predicates into WHERE,
// where SQLite can use the resources indexes before grouping generations. Other
// predicates remain in HAVING because attribute filters inspect the grouped
// current document projection. Location predicates nested under OR stay intact.
func splitDocumentLocationFilters(filter *documents.DocumentFilter) (where []*documents.DocumentFilter, having *documents.DocumentFilter) {
	if isDocumentLocationFilter(filter) {
		return []*documents.DocumentFilter{filter}, nil
	}
	and, ok := filter.GetFilter().(*documents.DocumentFilter_And_)
	if !ok || and.And == nil {
		return nil, filter
	}

	rest := make([]*documents.DocumentFilter, 0, len(and.And.Filters))
	for _, child := range and.And.Filters {
		if isDocumentLocationFilter(child) {
			where = append(where, child)
		} else {
			rest = append(rest, child)
		}
	}
	switch len(rest) {
	case 0:
		return where, nil
	case 1:
		return where, rest[0]
	default:
		return where, &documents.DocumentFilter{Filter: &documents.DocumentFilter_And_{And: &documents.DocumentFilter_And{Filters: rest}}}
	}
}

func isDocumentLocationFilter(filter *documents.DocumentFilter) bool {
	if filter == nil {
		return false
	}
	switch value := filter.Filter.(type) {
	case *documents.DocumentFilter_SpaceMatch_, *documents.DocumentFilter_PathMatch_, *documents.DocumentFilter_UrlMatch:
		return true
	case *documents.DocumentFilter_Not_:
		return value.Not != nil && isDocumentLocationFilter(value.Not.Filter)
	default:
		return false
	}
}

func autocompletePage(inSize int32, token string) (size, offset int, err error) {
	if inSize <= 0 {
		inSize = defaultPageSize
	}
	if inSize > 1000 {
		return 0, 0, status.Error(codes.InvalidArgument, "page_size must not exceed 1000")
	}
	cursor := struct {
		Offset int `json:"o"`
	}{}
	if token != "" {
		if err := apiutil.DecodePageToken(token, &cursor, nil); err != nil {
			return 0, 0, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}
	if cursor.Offset < 0 {
		return 0, 0, status.Error(codes.InvalidArgument, "invalid page token offset")
	}
	return int(inSize), cursor.Offset, nil
}

func validateAttributePath(path []string, required bool) error {
	if required && len(path) == 0 {
		return status.Error(codes.InvalidArgument, "attribute path is required")
	}
	for _, segment := range path {
		if segment == "" || strings.Contains(segment, ".") {
			return status.Error(codes.InvalidArgument, "attribute path segments must be non-empty and must not contain dots")
		}
	}
	for _, segment := range path {
		if strings.HasPrefix(segment, "$") {
			return status.Error(codes.InvalidArgument, "internal attributes are not available")
		}
	}
	return nil
}

func autocompleteAccount(account string) (core.Principal, error) {
	if account == "" {
		return nil, nil
	}
	principal, err := core.DecodePrincipal(account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid account: %v", err)
	}
	return principal, nil
}

type attributeAutocompleteQueries struct {
	all           dqb.LazyQuery
	publicOnly    dqb.LazyQuery
	authenticated dqb.LazyQuery
}

const attributeAutocompleteEligibleDocuments = `
	WITH requested_space AS (
		SELECT id FROM public_keys WHERE principal = ?
	), eligible_documents AS (
		SELECT dg.resource, r.owner AS space
		FROM document_generations dg, resources r
		WHERE r.id = dg.resource
		GROUP BY dg.resource
		HAVING dg.generation = MAX(dg.generation) AND dg.is_deleted = 0%s
	)
`

func newAttributeAutocompleteQueries(body string) attributeAutocompleteQueries {
	return attributeAutocompleteQueries{
		all:           dqb.Str(fmt.Sprintf(attributeAutocompleteEligibleDocuments, "") + body),
		publicOnly:    dqb.Str(fmt.Sprintf(attributeAutocompleteEligibleDocuments, " AND "+publicOnlyListVisibilityFilter) + body),
		authenticated: dqb.Str(fmt.Sprintf(attributeAutocompleteEligibleDocuments, " AND "+authenticatedListVisibilityFilter) + body),
	}
}

func (srv *Server) attributeAutocompleteQuery(ctx context.Context, queries attributeAutocompleteQueries, account core.Principal) (dqb.LazyQuery, []any) {
	args := []any{[]byte(account)}
	if !srv.cfg.PublicOnly {
		return queries.all, args
	}
	if caller, ok := blob.GetAuthenticatedCaller(ctx); ok {
		return queries.authenticated, append(args, []byte(caller))
	}
	return queries.publicOnly, args
}

var attributeAutocompleteNameQueries = newAttributeAutocompleteQueries(`
	, matching_keys AS MATERIALIZED (
		SELECT id, key, search_key
		FROM document_attribute_keys
		WHERE key NOT GLOB '$*'
			AND key NOT GLOB '*.$*'
			AND search_key >= ?
			AND search_key < ? || X'FFFF'
			AND (? = '' OR substr(key, 1, length(?) + 1) = ? || '.')
	)
	, direct_children AS (
		SELECT DISTINCT da.resource,
			CASE WHEN ? THEN mk.key ELSE attribute_path_segment(mk.key, ?) END AS name,
			CASE
				WHEN ? OR attribute_path_segment(mk.key, ?) IS NULL THEN CASE da.kind
					WHEN 's' THEN 2
					WHEN 'b' THEN 4
					WHEN 'i' THEN 3
				END
				ELSE 1
			END AS kind,
			CASE WHEN ed.space = (SELECT id FROM requested_space) THEN 0 ELSE 1 END AS scope_rank
		FROM matching_keys mk
		JOIN document_attributes da ON da.key = mk.id
		JOIN eligible_documents ed ON ed.resource = da.resource
		WHERE da.value IS NOT NULL
			AND da.kind IN ('s', 'b', 'i')
	), ranked_names AS (
		SELECT name, MIN(scope_rank) AS scope_rank
		FROM direct_children
		GROUP BY name
	), name_kinds AS (
		SELECT dc.name, dc.kind
		FROM direct_children dc
		JOIN ranked_names rn ON rn.name = dc.name AND rn.scope_rank = dc.scope_rank
		GROUP BY dc.name, dc.kind
	)
	SELECT rn.name,
		(
			SELECT json_group_array(kind)
			FROM (
				SELECT kind
				FROM name_kinds
				WHERE name = rn.name
				ORDER BY kind
			)
		) AS kinds
	FROM ranked_names rn
	ORDER BY rn.scope_rank, attribute_search_key(rn.name), rn.name
	LIMIT ? OFFSET ?
`)

func newAttributeAutocompleteValueQueries(display string) attributeAutocompleteQueries {
	return newAttributeAutocompleteQueries(fmt.Sprintf(`
		, matching_values AS (
			SELECT DISTINCT da.value,
				%s AS display
			FROM document_attributes da
			JOIN document_attribute_keys dak ON dak.id = da.key
			JOIN eligible_documents ed ON ed.resource = da.resource
			WHERE da.value IS NOT NULL
				AND dak.key = ?
				AND (NOT EXISTS (SELECT 1 FROM requested_space) OR ed.space = (SELECT id FROM requested_space))
				AND da.kind = ?
				AND substr(attribute_search_key(%s), 1, length(?)) = ?
		)
		SELECT value
		FROM matching_values
		ORDER BY attribute_search_key(display), display
		LIMIT ? OFFSET ?
	`, display, display))
}

var (
	attributeAutocompleteStringValueQueries = newAttributeAutocompleteValueQueries("da.value")
	attributeAutocompleteIntValueQueries    = newAttributeAutocompleteValueQueries("CAST(da.value AS TEXT)")
	attributeAutocompleteBoolValueQueries   = newAttributeAutocompleteValueQueries("CASE da.value WHEN 0 THEN 'false' ELSE 'true' END")
)

// ListDocumentAttributeNames lists user-defined document attribute names for autocomplete.
func (srv *Server) ListDocumentAttributeNames(ctx context.Context, in *documents.ListDocumentAttributeNamesRequest) (*documents.ListDocumentAttributeNamesResponse, error) {
	if err := validateAttributePath(in.GetParentPath(), false); err != nil {
		return nil, err
	}
	account, err := autocompleteAccount(in.GetAccount())
	if err != nil {
		return nil, err
	}
	pageSize, offset, err := autocompletePage(in.GetPageSize(), in.GetPageToken())
	if err != nil {
		return nil, err
	}
	out := &documents.ListDocumentAttributeNamesResponse{}
	searchPath := attrkey.SearchPath(in.GetParentPath())
	fullPrefix := strings.Join(append(searchPath, attrkey.SearchKey(in.GetPrefix())), ".")
	exactParent := strings.Join(in.GetParentPath(), ".")
	depth := len(in.GetParentPath())
	query, args := srv.attributeAutocompleteQuery(ctx, attributeAutocompleteNameQueries, account)
	args = append(args, fullPrefix, fullPrefix, exactParent, exactParent, exactParent, in.GetRecursive(), depth, in.GetRecursive(), depth+1, pageSize+1, offset)

	conn, release, err := srv.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	err = sqlitex.ExecTransient(conn, query(), func(row *sqlite.Stmt) error {
		if len(out.Names) == pageSize {
			out.NextPageToken = apiutil.EncodePageToken(struct {
				Offset int `json:"o"`
			}{Offset: offset + pageSize}, nil)
			return nil
		}
		var kinds []documents.DocumentAttributeKind
		if err := json.Unmarshal([]byte(row.ColumnText(1)), &kinds); err != nil {
			return err
		}
		item := &documents.DocumentAttributeName{
			Name:  row.ColumnText(0),
			Kinds: make([]*documents.DocumentAttributeKindUsage, 0, len(kinds)),
		}
		for _, kind := range kinds {
			item.Kinds = append(item.Kinds, &documents.DocumentAttributeKindUsage{Kind: kind})
		}
		out.Names = append(out.Names, item)
		return nil
	}, args...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ListDocumentAttributeValues lists known values for a user-defined document attribute.
func (srv *Server) ListDocumentAttributeValues(ctx context.Context, in *documents.ListDocumentAttributeValuesRequest) (*documents.ListDocumentAttributeValuesResponse, error) {
	if err := validateAttributePath(in.GetPath(), true); err != nil {
		return nil, err
	}
	if in.GetKind() != documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_STRING &&
		in.GetKind() != documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_INT &&
		in.GetKind() != documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_BOOL {
		return nil, status.Error(codes.InvalidArgument, "kind must be a scalar attribute kind")
	}
	account, err := autocompleteAccount(in.GetAccount())
	if err != nil {
		return nil, err
	}
	pageSize, offset, err := autocompletePage(in.GetPageSize(), in.GetPageToken())
	if err != nil {
		return nil, err
	}
	wantKey := strings.Join(in.GetPath(), ".")
	out := &documents.ListDocumentAttributeValuesResponse{}
	var queries attributeAutocompleteQueries
	var indexedKind string
	switch in.GetKind() {
	case documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_STRING:
		queries = attributeAutocompleteStringValueQueries
		indexedKind = indexedAttributeString
	case documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_INT:
		queries = attributeAutocompleteIntValueQueries
		indexedKind = indexedAttributeInt
	case documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_BOOL:
		queries = attributeAutocompleteBoolValueQueries
		indexedKind = indexedAttributeBool
	}
	query, args := srv.attributeAutocompleteQuery(ctx, queries, account)
	prefix := attrkey.SearchKey(in.GetPrefix())
	args = append(args, wantKey, indexedKind, prefix, prefix, pageSize+1, offset)

	conn, release, err := srv.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	err = sqlitex.ExecTransient(conn, query(), func(row *sqlite.Stmt) error {
		if len(out.Values) == pageSize {
			out.NextPageToken = apiutil.EncodePageToken(struct {
				Offset int `json:"o"`
			}{Offset: offset + pageSize}, nil)
			return nil
		}
		value := &documents.AttributeValue{}
		switch in.GetKind() {
		case documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_STRING:
			value.Value = &documents.AttributeValue_StringValue{StringValue: row.ColumnText(0)}
		case documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_INT:
			value.Value = &documents.AttributeValue_IntValue{IntValue: row.ColumnInt64(0)}
		case documents.DocumentAttributeKind_DOCUMENT_ATTRIBUTE_KIND_BOOL:
			value.Value = &documents.AttributeValue_BoolValue{BoolValue: row.ColumnInt64(0) != 0}
		}
		out.Values = append(out.Values, &documents.DocumentAttributeValue{
			Value: value,
		})
		return nil
	}, args...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func documentFilterSQL(filter *documents.DocumentFilter, args *colx.Slice[any], depth int) (string, error) {
	if filter == nil {
		return "1", nil
	}
	if depth == 32 {
		return "", status.Error(codes.InvalidArgument, "content filter is too deeply nested")
	}

	attribute := func(key string, condition string, conditionArgs ...any) (string, error) {
		if key == "" {
			return "", status.Error(codes.InvalidArgument, "attribute key is required")
		}
		args.Append(key)
		args.Append(conditionArgs...)
		return "EXISTS (SELECT 1 FROM document_attributes da WHERE da.resource = dg.resource AND da.key = (SELECT id FROM document_attribute_keys WHERE key = ?) AND " + condition + ")", nil
	}
	join := func(filters []*documents.DocumentFilter, operator, empty string) (string, error) {
		if len(filters) == 0 {
			return empty, nil
		}
		parts := make([]string, 0, len(filters))
		for _, child := range filters {
			part, err := documentFilterSQL(child, args, depth+1)
			if err != nil {
				return "", err
			}
			parts = append(parts, "("+part+")")
		}
		return strings.Join(parts, " "+operator+" "), nil
	}

	switch value := filter.Filter.(type) {
	case *documents.DocumentFilter_And_:
		if value.And == nil {
			return "", status.Error(codes.InvalidArgument, "and filter is required")
		}
		return join(value.And.Filters, "AND", "1")
	case *documents.DocumentFilter_Or_:
		if value.Or == nil {
			return "", status.Error(codes.InvalidArgument, "or filter is required")
		}
		return join(value.Or.Filters, "OR", "0")
	case *documents.DocumentFilter_Not_:
		if value.Not == nil || value.Not.Filter == nil {
			return "", status.Error(codes.InvalidArgument, "not filter requires a filter")
		}
		child, err := documentFilterSQL(value.Not.Filter, args, depth+1)
		return "NOT (" + child + ")", err
	case *documents.DocumentFilter_Exists:
		if value.Exists == nil {
			return "", status.Error(codes.InvalidArgument, "exists filter is required")
		}
		return attribute(value.Exists.Key, "value IS NOT NULL")
	case *documents.DocumentFilter_Missing:
		if value.Missing == nil || value.Missing.Key == "" {
			return "", status.Error(codes.InvalidArgument, "attribute key is required")
		}
		args.Append(value.Missing.Key)
		return "NOT EXISTS (SELECT 1 FROM document_attributes da WHERE da.resource = dg.resource AND da.key = (SELECT id FROM document_attribute_keys WHERE key = ?) AND da.value IS NOT NULL)", nil
	case *documents.DocumentFilter_StringMatch_:
		if value.StringMatch == nil {
			return "", status.Error(codes.InvalidArgument, "string_match filter is required")
		}
		match := value.StringMatch
		condition := "kind = 's' AND "
		if match.Prefix {
			if match.CaseSensitive {
				condition += "substr(value, 1, length(?)) = ?"
				return attribute(match.Key, condition, match.Value, match.Value)
			}
			searchValue := attrkey.SearchKey(match.Value)
			condition += "substr(attribute_search_key(value), 1, length(?)) = ?"
			return attribute(match.Key, condition, searchValue, searchValue)
		} else if match.CaseSensitive {
			condition += "instr(value, ?) > 0"
			return attribute(match.Key, condition, match.Value)
		}
		condition += "instr(attribute_search_key(value), ?) > 0"
		return attribute(match.Key, condition, attrkey.SearchKey(match.Value))
	case *documents.DocumentFilter_UrlMatch:
		if value.UrlMatch == nil {
			return "", status.Error(codes.InvalidArgument, "url_match filter is required")
		}
		match := value.UrlMatch
		account, path, err := blob.IRI(match.Url).SpacePath()
		if err != nil {
			return "", status.Errorf(codes.InvalidArgument, "invalid URL: %v", err)
		}
		canonical, err := blob.NewIRI(account, path)
		if err != nil || canonical.String() != match.Url {
			return "", status.Error(codes.InvalidArgument, "URL must be a canonical hm:// document URL")
		}
		args.Append(match.Url)
		if !match.Prefix {
			return "r.iri = ?", nil
		}
		args.Append(match.Url, match.Url)
		return "(r.iri = ? OR substr(r.iri, 1, length(?) + 1) = ? || '/')", nil
	case *documents.DocumentFilter_SpaceMatch_:
		if value.SpaceMatch == nil {
			return "", status.Error(codes.InvalidArgument, "space_match filter is required")
		}
		space, err := core.DecodePrincipal(value.SpaceMatch.Space)
		if err != nil {
			return "", status.Errorf(codes.InvalidArgument, "invalid space: %v", err)
		}
		args.Append([]byte(space))
		return "r.owner = (SELECT id FROM public_keys WHERE principal = ?)", nil
	case *documents.DocumentFilter_PathMatch_:
		if value.PathMatch == nil {
			return "", status.Error(codes.InvalidArgument, "path_match filter is required")
		}
		match := value.PathMatch
		if match.Path != "" && (!strings.HasPrefix(match.Path, "/") || strings.HasSuffix(match.Path, "/")) {
			return "", status.Error(codes.InvalidArgument, "path must be empty or start with a slash and not end with one")
		}
		if match.Prefix && match.Path == "" {
			return "1", nil
		}
		const pathSQL = "(CASE WHEN instr(substr(r.iri, 6), '/') = 0 THEN '' ELSE substr(r.iri, 5 + instr(substr(r.iri, 6), '/')) END)"
		args.Append(match.Path)
		if !match.Prefix {
			return pathSQL + " = ?", nil
		}
		args.Append(match.Path, match.Path)
		return "(" + pathSQL + " = ? OR substr(" + pathSQL + ", 1, length(?) + 1) = ? || '/')", nil
	case *documents.DocumentFilter_Comparison_:
		if value.Comparison == nil || value.Comparison.Value == nil {
			return "", status.Error(codes.InvalidArgument, "comparison requires a value")
		}
		comparison := value.Comparison
		operator := map[documents.DocumentFilter_Comparison_Operator]string{
			documents.DocumentFilter_Comparison_EQUAL:                 "=",
			documents.DocumentFilter_Comparison_NOT_EQUAL:             "!=",
			documents.DocumentFilter_Comparison_LESS_THAN:             "<",
			documents.DocumentFilter_Comparison_LESS_THAN_OR_EQUAL:    "<=",
			documents.DocumentFilter_Comparison_GREATER_THAN:          ">",
			documents.DocumentFilter_Comparison_GREATER_THAN_OR_EQUAL: ">=",
		}[comparison.Operator]
		if operator == "" {
			return "", status.Error(codes.InvalidArgument, "comparison operator is required")
		}
		var kind string
		var operand any
		switch attr := comparison.Value.Value.(type) {
		case *documents.AttributeValue_NullValue:
			kind = "n"
		case *documents.AttributeValue_StringValue:
			kind, operand = "s", attr.StringValue
		case *documents.AttributeValue_IntValue:
			kind, operand = "i", attr.IntValue
		case *documents.AttributeValue_BoolValue:
			kind, operand = "b", attr.BoolValue
		default:
			return "", status.Error(codes.InvalidArgument, "comparison value is required")
		}
		if kind == "n" {
			if comparison.Operator != documents.DocumentFilter_Comparison_EQUAL && comparison.Operator != documents.DocumentFilter_Comparison_NOT_EQUAL {
				return "", status.Error(codes.InvalidArgument, "null only supports equality comparisons")
			}
			condition := "kind = 'n'"
			if comparison.Operator == documents.DocumentFilter_Comparison_NOT_EQUAL {
				condition = "kind != 'n' AND value IS NOT NULL"
			}
			return attribute(comparison.Key, condition)
		}
		if kind == "b" && comparison.Operator != documents.DocumentFilter_Comparison_EQUAL && comparison.Operator != documents.DocumentFilter_Comparison_NOT_EQUAL {
			return "", status.Error(codes.InvalidArgument, "boolean only supports equality comparisons")
		}
		return attribute(comparison.Key, "kind = ? AND value "+operator+" ?", kind, operand)
	default:
		return "", status.Error(codes.InvalidArgument, "content filter is required")
	}
}

// documentNameSortSQL sorts by the document's "name" attribute, matching the
// ListDirectory NAME ordering.
const documentNameSortSQL = "COALESCE((SELECT value FROM document_attributes da WHERE da.resource = dg.resource AND da.key = (SELECT id FROM document_attribute_keys WHERE key = 'name') AND da.kind = 's'), '')"

func documentSortSQL(sort []*documents.DocumentSort, args *colx.Slice[any]) (string, error) {
	if len(sort) == 0 {
		return "r.iri ASC", nil
	}
	if len(sort) > maxQueryDocumentSorts {
		return "", status.Errorf(codes.InvalidArgument, "at most %d sort attributes are supported", maxQueryDocumentSorts)
	}
	parts := make([]string, 0, len(sort)+1)
	for _, item := range sort {
		if item == nil {
			return "", status.Error(codes.InvalidArgument, "sort attribute is required")
		}
		expr, err := documentSortExprSQL(item, args)
		if err != nil {
			return "", err
		}
		direction := "ASC"
		if item.Descending {
			direction = "DESC"
		}
		parts = append(parts, expr+" "+direction)
	}
	return strings.Join(append(parts, "r.iri ASC"), ", "), nil
}

// documentSortExprSQL returns the SQL expression a single DocumentSort orders
// by. Built-in fields take precedence over the user-defined attribute key.
func documentSortExprSQL(item *documents.DocumentSort, args *colx.Slice[any]) (string, error) {
	switch item.Attribute {
	case documents.BuiltinSortAttribute_BUILTIN_SORT_ATTRIBUTE_UNSPECIFIED:
		if item.Key == "" {
			return "", status.Error(codes.InvalidArgument, "sort attribute key is required")
		}
		args.Append(item.Key)
		return "(SELECT value FROM document_attributes da WHERE da.resource = dg.resource AND da.key = (SELECT id FROM document_attribute_keys WHERE key = ?))", nil
	case documents.BuiltinSortAttribute_BUILTIN_SORT_ATTRIBUTE_NAME:
		return documentNameSortSQL, nil
	case documents.BuiltinSortAttribute_BUILTIN_SORT_ATTRIBUTE_PATH:
		return "r.iri", nil
	case documents.BuiltinSortAttribute_BUILTIN_SORT_ATTRIBUTE_CREATE_TIME:
		return "dg.genesis_change_time", nil
	case documents.BuiltinSortAttribute_BUILTIN_SORT_ATTRIBUTE_UPDATE_TIME:
		return "dg.last_change_time", nil
	case documents.BuiltinSortAttribute_BUILTIN_SORT_ATTRIBUTE_ACTIVITY_TIME:
		return "activity_time", nil
	case documents.BuiltinSortAttribute_BUILTIN_SORT_ATTRIBUTE_COMMENT_COUNT:
		return "comment_count", nil
	default:
		return "", status.Errorf(codes.InvalidArgument, "unsupported sort attribute %v", item.Attribute)
	}
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

	srv.clampPageSize("ListDirectory", &in.PageSize, defaultPageSize)

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

		qb := baseListDocumentsQuery(commentAggSubtree)

		// The comment aggregation is scoped to the same subtree as the row filter below.
		// It's a LEFT JOIN, so it precedes the WHERE clause and binds first. The scope
		// appears twice inside it (targets, then credits), so it binds twice.
		args.Append(baseIRI, baseIRI+"/", baseIRI+"0")
		args.Append(baseIRI, baseIRI+"/", baseIRI+"0")

		if publicOnly, err := srv.isPublicOnlyFor(ctx, ns, in.DirectoryPath); err != nil {
			return nil, err
		} else if publicOnly {
			qb.Where(publicOnlyListVisibilityFilter)
		}

		qb.Where("(r.iri = ? OR (r.iri >= ? AND r.iri < ?))")
		args.Append(baseIRI, baseIRI+"/", baseIRI+"0")

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

		var outerOrder string
		switch in.SortOptions.Attribute {
		case documents.SortAttribute_ACTIVITY_TIME:
			qb.Where("activity_time " + paginationCmp + " ?")
			args.Append(cursor.ActivityTime)

			qb.OrderBy("activity_time " + order)
			outerOrder = "activity_time " + order
		case documents.SortAttribute_NAME:
			qb.Having("COALESCE((SELECT value FROM document_attributes da WHERE da.resource = dg.resource AND da.key = (SELECT id FROM document_attribute_keys WHERE key = 'name') AND da.kind = 's'), '') " + paginationCmp + " ?")
			args.Append(cursor.NameOrPath)
			qb.OrderBy("COALESCE((SELECT value FROM document_attributes da WHERE da.resource = dg.resource AND da.key = (SELECT id FROM document_attribute_keys WHERE key = 'name') AND da.kind = 's'), '') " + order)
			outerOrder = "COALESCE(json_extract(i.metadata, '$.name.v'), '') " + order
		case documents.SortAttribute_PATH:
			qb.Where("r.iri " + paginationCmp + " ?")
			args.Append(cursor.NameOrPath)

			qb.OrderBy("r.iri " + order)
			outerOrder = "i.iri " + order
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported sort attribute %v", in.SortOptions.Attribute)
		}

		args.Append(in.PageSize)
		query = wrapDocumentsQuery(qb, outerOrder)
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

	// Every account's home document, in one query rather than one per account.
	{
		iris := make([]blob.IRI, len(out.Accounts))
		for i, acc := range out.Accounts {
			iris[i] = blob.IRI("hm://" + acc.Id)
		}

		infos, err := getRootDocumentInfos(conn, lookup, iris)
		if err != nil {
			return nil, fmt.Errorf("failed to load home document info: %w", err)
		}

		// Accounts with no home document simply aren't in the map, which leaves
		// HomeDocumentInfo nil — the same result the per-account lookup produced
		// when it returned NotFound.
		for i, acc := range out.Accounts {
			acc.HomeDocumentInfo = infos[iris[i]]
		}
	}

	return out, nil
}

// getRootDocumentInfos loads the document info for a set of root (home) document IRIs
// using a single query.
//
// ListAccounts used to call [getDocumentInfo] once per account. That is a full
// single-document query — recursive redirect walk, comment aggregation and the
// children_count subquery — re-run N times on one connection. Measured against a real
// database it cost 513ms for 321 accounts (mean 1.6ms, p95 4.5ms, slowest 8.8ms) on top
// of a 10ms main query, and it grows linearly with the account count: ~1.6s at 1000
// accounts and ~4.8s at 3000, which is where the desktop app starts reporting the call
// as hung.
//
// Home documents are exactly the root document of each space, which is the scope
// [commentAggRoots] already covers, so the listing aggregation can serve them directly.
// It takes no bound parameters, so the only bindings here are the IRIs and the page
// size. This also makes the home document info consistent with what ListRootDocuments
// reports for the same documents, since both now derive it the same way.
func getRootDocumentInfos(conn *sqlite.Conn, lookup *blob.LookupCache, iris []blob.IRI) (out map[blob.IRI]*documents.DocumentInfo, err error) {
	if len(iris) == 0 {
		return nil, nil
	}

	qb := baseListDocumentsQuery(commentAggRoots)
	qb.Where("r.iri IN (" + strings.TrimSuffix(strings.Repeat("?,", len(iris)), ",") + ")")

	args := make([]any, 0, len(iris)+1)
	for _, iri := range iris {
		args = append(args, iri)
	}
	// Page size must be the last binding parameter (see baseDocumentsQuery). Each IRI
	// matches at most one row, so the requested set size is the bound.
	args = append(args, len(iris))

	out = make(map[blob.IRI]*documents.DocumentInfo, len(iris))
	rows, discard, check := sqlitex.Query(conn, wrapDocumentsQuery(qb, ""), args...).All()
	defer discard(&err)
	for row := range rows {
		info, _, err := documentInfoFromRow(lookup, row)
		if err != nil {
			return nil, err
		}
		out[blob.IRI("hm://"+info.Account)] = info
	}
	if err := check(); err != nil {
		return nil, err
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
			"(SELECT COALESCE(json_group_object(dak.key, json_object('key', dak.key, 'v', da.value, 't', da.timestamp, 'o', da.operation, 'a', da.actor, 'k', da.kind)), '{}') FROM document_attributes da JOIN document_attribute_keys dak ON dak.id = da.key WHERE da.resource = (SELECT resources.id FROM resources WHERE iri = 'hm://' || spaces.id)) AS metadata",
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
		// The comment aggregation is scoped to root documents, matching the row filter
		// below. The scope takes no parameters, so binding order is unaffected.
		qb := baseListDocumentsQuery(commentAggRoots).OrderBy("activity_time DESC")

		qb.Where("r.iri GLOB 'hm://*'")
		qb.Where("r.iri NOT GLOB 'hm://*/*'")

		qb.Where("activity_time < ?", "r.iri < ?")
		args.Append(cursor.ActivityTime, cursor.IRI)

		srv.applyListVisibilityFilter(ctx, qb, &args)

		args.Append(in.PageSize)
		query = wrapDocumentsQuery(qb, "activity_time DESC")
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
		// Resolve the account scope up front: the comment aggregation is scoped to the
		// same resources the row filter selects, and being a LEFT JOIN it binds first.
		// The scope appears twice inside it (targets, then credits), so it binds twice.
		var (
			commentAgg = commentAggAll
			accountIRI blob.IRI
			publicOnly bool
		)
		if in.Account != "" {
			ns, err := core.DecodePrincipal(in.Account)
			if err != nil {
				return nil, fmt.Errorf("failed to decode account: %w", err)
			}

			publicOnly, err = srv.isPublicOnlyFor(ctx, ns, "")
			if err != nil {
				return nil, err
			}

			accountIRI, err = blob.NewIRI(ns, "")
			if err != nil {
				return nil, err
			}

			commentAgg = commentAggSubtree
			args.Append(accountIRI, accountIRI+"/", accountIRI+"0")
			args.Append(accountIRI, accountIRI+"/", accountIRI+"0")
		}

		qb := baseListDocumentsQuery(commentAgg).OrderBy("activity_time DESC")

		if in.Account == "" {
			qb.Where("r.iri GLOB 'hm://*'")
		} else {
			if publicOnly {
				qb.Where(publicOnlyListVisibilityFilter)
			}

			qb.Where("(r.iri = ? OR (r.iri >= ? AND r.iri < ?))")
			args.Append(accountIRI, accountIRI+"/", accountIRI+"0")
		}

		qb.Where("activity_time < ?", "r.iri < ?")
		args.Append(cursor.ActivityTime, cursor.IRI)
		if in.Account == "" {
			srv.applyListVisibilityFilter(ctx, qb, &args)
		}

		args.Append(in.PageSize)
		query = wrapDocumentsQuery(qb, "activity_time DESC")
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
	q := wrapDocumentsQuery(baseSingleDocumentQuery().Where("r.iri = ?"), "")
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

// qSingleDocCommentAgg is the single-document counterpart of qListDocsCommentAggScoped.
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
		JOIN document_attributes da ON da.kind = 's' AND da.value = ra.iri
		JOIN document_attribute_keys dak ON dak.id = da.key AND dak.key = '$db.redirect'
		JOIN document_generations dg ON dg.resource = da.resource
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

// Prebuilt comment aggregations, one per listing scope. Each scope predicate must select
// exactly the resources its listing can return, expressed over the `tr` alias of
// `resources`, and must bind the same values as the outer query's `r.iri` filter (see the
// binding order note on [baseListDocumentsQuery]).
//
// A parameterised scope appears *twice* in the generated SQL, so its callers must bind its
// arguments twice — see [qListDocsCommentAggScoped].
//
// These are built once rather than per request: the scopes are fixed, and assembling a
// couple of kilobytes of SQL on every call would be pure waste on a hot path.
var (
	// commentAggSubtree covers one document and everything below it. The subtree is
	// expressed as an explicit range rather than GLOB because a parameterized GLOB
	// inside an OR never seeks the resources.iri index (the prefix optimization doesn't
	// apply to it there), while the equivalent range becomes a MULTI-INDEX OR of two
	// seeks. Callers bind (iri, iri+"/", iri+"0") — '0' is '/'+1, so the range is
	// exactly the iri+"/*" prefix, same trick as children_count below.
	commentAggSubtree = qListDocsCommentAggScoped(`tr.iri = ? OR (tr.iri >= ? AND tr.iri < ?)`)

	// commentAggRoots covers the root document of every space.
	commentAggRoots = qListDocsCommentAggScoped(`tr.iri GLOB 'hm://*' AND tr.iri NOT GLOB 'hm://*/*'`)

	// commentAggAll covers every document in the database. It's the widest scope, and it's
	// also the hottest: the desktop app lists documents with no account filter on load.
	commentAggAll = qListDocsCommentAggScoped(`tr.iri GLOB 'hm://*'`)
)

// qListDocsCommentAggScoped computes each listed document's comment activity (count,
// latest comment) directly from the indexed Comment blobs, deduplicating edits by TSID
// and dropping deleted comments, and credits every comment both to the resource it
// targets and to all transitive redirect targets of that resource.
//
// It exists because comment blobs record the document path as it was when the comment was
// written: after a document moves, its comments stay attached to the old path's resource,
// and the incrementally-maintained document_generations.comment_count of the new path's
// resource knows nothing about them. Deriving the stats from the blobs at query time keeps
// listings consistent with what ListComments actually returns for the document (which
// walks the same redirect relation backwards via redirectAncestorsCTE), no matter in which
// order the blobs arrived.
//
// It is scoped because the original unscoped form derived its stats from *every* Comment
// blob in the database. Such a subquery can't be flattened (CTEs + aggregates) and the
// outer r.iri filter can't be pushed into it, so SQLite materialized a whole-database
// aggregate before emitting a single row — on every request. That cost is linear in total
// comment count and independent of the directory being listed, which is what saturated the
// production gateway's CPU. Seeding from `targets` instead keeps the work proportional to
// the listing: the comment scan seeks structural_blobs_by_resource rather than scanning
// structural_blobs_by_type, and this applies to listings the same trick
// [qSingleDocCommentAgg] already applies to point lookups.
//
// Semantics are preserved exactly, and the subtle part is the TSID dedup. A comment edit
// can land on a *different* resource than the original once a document has moved, so
// restricting the ROW_NUMBER() partitions to in-scope blobs could let an edit win a
// partition it loses globally, and inflate a count. So the scope picks candidate *TSIDs*
// (cand_tsids), and the window then runs over every blob carrying one of them — including
// blobs outside the scope. Winner-per-TSID is therefore identical to the unscoped query;
// losers outside the scope simply credit nothing. Comment blobs always carry a TSID
// (blob_comment.go sets it unconditionally), so the partition key is never NULL.
//
// `deduped` fetches those blobs by JOINing cand_tsids rather than with an IN subquery:
// an equality join term proves the partial structural_blobs_by_tsid index's IS NOT NULL
// predicate, so each candidate TSID is a seek, whereas `tsid IN (SELECT …)` cannot prove
// it and degraded to scanning every Comment blob in the database via
// structural_blobs_by_type on each call.
//
// The scope must be written in terms of the `tr` alias of `resources` (e.g.
// `tr.iri GLOB 'hm://*'`), because it is applied in two places, and callers with a
// parameterised scope must therefore bind its arguments TWICE: once for `targets`, then
// once for `credits`, in that order. The duplication is deliberate. `credits` already
// joins `resources tr`, and testing membership there via `tr.id IN (SELECT id FROM
// targets)` was quadratic: `chains` is a recursive CTE consumed as a co-routine, so SQLite
// re-evaluated the IN list per row instead of materializing it once (~2k chain rows × ~7k
// target rows ≈ 15M scans ≈ 2.5s on a real database, and MATERIALIZED hints on `targets`,
// `redirected` or `chains` did not fix THAT problem). Applying the predicate directly to
// `tr.iri` makes it a filter on a row already in hand: same rows, ~0.07s instead of ~2.5s.
//
// The parenthetical above used to read "did not help", full stop. It is scoped to the
// IN-list pathology, and reading it more broadly steered the 2026-08-11 outage response
// away from the actual fix: `redirected` is also referenced from the recursive term of
// `chains`, where it was re-derived once per visited row at ~5.5s per listing call. It now
// carries a MATERIALIZED hint for that separate reason (see the comment on it below). That
// win was invisible when the note was written, because the 2.5s IN-list scan dominated.
func qListDocsCommentAggScoped(scope string) string {
	return `(
	WITH RECURSIVE
	targets AS (
		SELECT id FROM resources tr WHERE (` + scope + `)
	),
	redirected AS MATERIALIZED (
		-- MATERIALIZED is load-bearing. This CTE is referenced from the recursive
		-- term of ` + "`chains`" + ` below, and without the hint SQLite re-derives it for
		-- every row the recursion visits, paying the correlated MAX(generation)
		-- subquery each time: ~2.2k rows x ~2.5ms = 5.5s of CPU per listing call,
		-- which saturated production on 2026-08-11. Materialized it's ~40ms.
		SELECT
			dg.resource AS resource,
			da.value AS redirect_iri
		FROM document_generations dg
		JOIN document_attributes da ON da.resource = dg.resource AND da.kind = 's'
		JOIN document_attribute_keys dak ON dak.id = da.key AND dak.key = '$db.redirect'
		WHERE da.value IS NOT NULL
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
		AND (` + scope + `)
	),
	sources AS (
		SELECT id FROM targets
		UNION
		SELECT source FROM credits
	),
	cand_tsids AS (
		SELECT DISTINCT sb.extra_attrs->>'tsid' AS tsid
		FROM structural_blobs sb
		WHERE sb.type = 'Comment'
		AND sb.resource IN (SELECT id FROM sources)
	),
	deduped AS (
		SELECT
			sb.resource AS resource,
			sb.id AS id,
			sb.ts AS ts,
			ROW_NUMBER() OVER (PARTITION BY sb.extra_attrs->>'tsid' ORDER BY sb.ts DESC, sb.id DESC) AS rn,
			sb.extra_attrs->>'deleted' AS deleted
		FROM cand_tsids ct
		JOIN structural_blobs sb ON sb.extra_attrs->>'tsid' = ct.tsid
		WHERE sb.type = 'Comment'
	),
	live AS (
		SELECT resource, id, ts FROM deduped WHERE rn = 1 AND deleted IS NULL
	),
	credited AS (
		SELECT l.resource AS resource, l.id, l.ts FROM live l
		WHERE l.resource IN (SELECT id FROM targets)
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
}

// baseListDocumentsQuery builds a listing query using one of the prebuilt scoped comment
// aggregations above. Callers must bind the scope's parameters (if any) *before* any other
// parameter, because the aggregation is a LEFT JOIN and so precedes the WHERE clause in the
// generated SQL.
func baseListDocumentsQuery(commentAgg string) *dqb.SelectQuery {
	return baseDocumentsQuery(commentAgg)
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
			"COALESCE((SELECT json_group_object(dak.key, json_object('key', dak.key, 'v', da.value, 't', da.timestamp, 'o', da.operation, 'a', da.actor, 'k', da.kind)) FROM document_attributes da JOIN document_attribute_keys dak ON dak.id = da.key WHERE da.resource = dg.resource), '{}') AS metadata",
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
			"dg.visibility",
		).
		// CROSS JOIN forces the join order: seek resources by IRI first, then probe
		// document_generations by its (resource, ...) primary key. Left to itself, the
		// stat-less planner prefers scanning all of document_generations because that
		// satisfies GROUP BY dg.resource without a sort — a whole-database scan on
		// every call, with the caller's IRI filter applied only after the join.
		From(
			"resources r CROSS JOIN document_generations dg",
		).
		LeftJoin(commentAggJoin, "agg.resource = dg.resource").
		Where("r.id = dg.resource").
		GroupBy("dg.resource").
		Having("dg.generation = MAX(dg.generation)", "dg.is_deleted = 0").
		Limit("? + 1")
}

// qDocumentsOuterColumns are the expensive per-row columns of the documents
// queries, evaluated in the outer layer of [wrapDocumentsQuery], i.e. only for
// the rows that survive the inner query's LIMIT. They reference the inner
// query's alias `i`, and they must stay the LAST columns of the statement,
// in this order, because [documentInfoFromRow] reads columns by position.
const qDocumentsOuterColumns = `    (SELECT 1 FROM unread_resources WHERE iri = i.iri) AS is_unread,
    -- Alive direct children of the document, so listing cards can show
    -- the subdocument count without a per-document interaction-summary
    -- request. The prefix-range comparison (everything between
    -- 'iri/' and 'iri0', '0' being the character after '/') seeks the
    -- resources.iri index instead of scanning; the instr check drops
    -- grandchildren; the innermost subquery keeps only resources whose
    -- latest generation is alive.
    (SELECT count(*)
      FROM resources cr
      WHERE cr.iri > i.iri || '/' AND cr.iri < i.iri || '0'
        AND instr(substr(cr.iri, length(i.iri) + 2), '/') = 0
        AND (SELECT cdg.is_deleted FROM document_generations cdg WHERE cdg.resource = cr.id ORDER BY cdg.generation DESC LIMIT 1) = 0
    ) AS children_count`

// wrapDocumentsQuery wraps a query built by [baseDocumentsQuery] into an outer
// SELECT that appends [qDocumentsOuterColumns]. The inner query keeps all the
// filtering, grouping, ordering and the LIMIT, so SQLite computes the expensive
// per-row subqueries only for the final page instead of for every candidate row
// of the scope (a recursive listing used to pay O(scope × children)
// document_generations probes for children_count alone, of which only
// page_size+1 rows survived the sorter).
//
// orderBy repeats the inner ordering in terms of the inner query's alias `i`
// (the wrapper alone doesn't guarantee preserving the inner order); pass ""
// for single-row lookups.
func wrapDocumentsQuery(qb *dqb.SelectQuery, orderBy string) string {
	var sb strings.Builder
	sb.WriteString("SELECT\n    i.*,\n")
	sb.WriteString(qDocumentsOuterColumns)
	sb.WriteString("\nFROM (\n")
	sb.WriteString(qb.String())
	sb.WriteString("\n) i")
	if orderBy != "" {
		sb.WriteString("\nORDER BY ")
		sb.WriteString(orderBy)
	}
	return sb.String()
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
		visibility        = blob.Visibility(row.ColumnText(inc()))
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

	// Whether this document has the structurally derived Collection shape. This is the single source of truth —
	// collections are identified by their shape, not by an authored metadata
	// flag, so the answer stays correct no matter which client wrote the
	// document or how old it is.
	//
	// Unset means the indexer has not derived it yet, which clients must read as
	// "not known to be a collection" rather than "not a collection": the
	// derivation is backfilled asynchronously.
	var isCollection *bool
	for _, key := range []string{blob.IsCollectionAttr, "$db.isFolder"} {
		if v, ok := attrs[key]; ok {
			if b, isBool := indexedAttrBool(v); isBool {
				isCollection = &b
				break
			}
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
		IsCollection:        isCollection,
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
		Visibility:   docmodel.VisibilityToProto(visibility),
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
			if err := validateAttributePath([]string{o.SetMetadata.Key}, true); err != nil {
				return err
			}
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
			if err := validateAttributePath(o.SetAttribute.Key, true); err != nil {
				return err
			}
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
		qb.Having(authenticatedListVisibilityFilter)
		args.Append([]byte(caller))
		return
	}
	qb.Having(publicOnlyListVisibilityFilter)
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

// indexedAttrBool reads a boolean indexed attribute.
//
// It has to tolerate two representations of the same value. In memory an
// attribute of kind "b" holds a real Go bool, but the listing rebuilds its
// attributes by unmarshalling a JSON aggregate assembled in SQL, and SQLite has
// no boolean type — the value makes the round trip as the INTEGER 1 or 0 and
// arrives here as a JSON number.
func indexedAttrBool(v blob.IndexedValue) (bool, bool) {
	switch value := v.Value.(type) {
	case bool:
		return value, true
	case float64:
		return value != 0, true
	case int64:
		return value != 0, true
	default:
		return false, false
	}
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
