// Package documents implements Documents API v3.
package documents

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"seed/backend/core"
	"seed/backend/daemon/api/documents/v3alpha/docmodel"
	"seed/backend/daemon/apiutil"
	"seed/backend/daemon/index"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/hlc"
	"seed/backend/pkg/dqb"
	"seed/backend/pkg/errutil"

	"crawshaw.io/sqlite"
	"crawshaw.io/sqlite/sqlitex"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// Server implements Documents API v3.
type Server struct {
	keys core.KeyStore
	idx  *index.Index
	db   *sqlitex.Pool
}

// NewServer creates a new Documents API v3 server.
func NewServer(keys core.KeyStore, idx *index.Index, db *sqlitex.Pool) *Server {
	return &Server{
		keys: keys,
		idx:  idx,
		db:   db,
	}
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	documents.RegisterDocumentsServer(rpc, srv)
}

// GetDocument implements Documents API v3.
func (srv *Server) GetDocument(ctx context.Context, in *documents.GetDocumentRequest) (*documents.Document, error) {
	{
		if in.Namespace == "" {
			return nil, errutil.MissingArgument("namespace")
		}

		if in.Version != "" {
			return nil, status.Error(codes.Unimplemented, "getting docs by version is not implemented yet")
		}
	}

	ns, err := core.DecodePrincipal(in.Namespace)
	if err != nil {
		return nil, err
	}

	doc, err := srv.loadDocument(ctx, ns, in.Path, false)
	if err != nil {
		return nil, err
	}

	return doc.Hydrate(ctx)
}

// CreateDocumentChange implements Documents API v3.
func (srv *Server) CreateDocumentChange(ctx context.Context, in *documents.CreateDocumentChangeRequest) (*documents.Document, error) {
	{
		if in.Namespace == "" {
			return nil, errutil.MissingArgument("namespace")
		}

		if in.SigningKeyName == "" {
			return nil, errutil.MissingArgument("signing_key_name")
		}

		if len(in.Changes) == 0 {
			return nil, status.Errorf(codes.InvalidArgument, "at least one change is required")
		}
	}

	ns, err := core.DecodePrincipal(in.Namespace)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode namespace %s: %v", in.Namespace, err)
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	if err := srv.checkWriteAccess(ctx, ns, in.Path, kp); err != nil {
		return nil, err
	}

	if in.Path == "" {
		if err := srv.ensureProfileGenesis(ctx, kp); err != nil {
			return nil, err
		}
	}

	doc, err := srv.loadDocument(ctx, ns, in.Path, true)
	if err != nil {
		return nil, err
	}

	if err := applyChanges(doc, in.Changes); err != nil {
		return nil, err
	}

	var newBlobs []blocks.Block

	docChange, err := doc.Change(kp)
	if err != nil {
		return nil, fmt.Errorf("failed to create subdoc change: %w", err)
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

	return srv.GetDocument(ctx, &documents.GetDocumentRequest{
		Namespace: in.Namespace,
		Path:      in.Path,
		// TODO implement getting specific version. Or do we want latest always?
		// Version:    parentVersion.String(),
	})
}

// ListRootDocuments implements Documents API v3.
func (srv *Server) ListRootDocuments(ctx context.Context, in *documents.ListRootDocumentsRequest) (*documents.ListRootDocumentsResponse, error) {
	type Cursor struct {
		ID int64 `json:"i"`
	}

	var (
		count      int32
		lastCursor = Cursor{
			ID: math.MaxInt64,
		}
	)

	if in.PageSize <= 0 {
		in.PageSize = 30
	}

	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &lastCursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	out := documents.ListRootDocumentsResponse{
		Documents: make([]*documents.DocumentListItem, 0, in.PageSize),
	}

	if err = sqlitex.Exec(conn, qListRootDocuments(), func(stmt *sqlite.Stmt) error {
		if count == in.PageSize {
			var err error
			out.NextPageToken, err = apiutil.EncodePageToken(lastCursor, nil)
			return err
		}
		count++

		var (
			id  = stmt.ColumnInt64(0)
			iri = stmt.ColumnText(1)
		)

		u, err := url.Parse(iri)
		if err != nil {
			return err
		}

		ns, err := core.DecodePrincipal(u.Host)
		if err != nil {
			return err
		}
		lastCursor.ID = id

		doc, err := srv.GetDocument(ctx, &documents.GetDocumentRequest{
			Namespace: ns.String(),
			Path:      "",
		})
		if err != nil {
			return err
		}

		// TODO: use indexed data instead of loading the entire document.
		out.Documents = append(out.Documents, DocumentToListItem(doc))

		return nil
	}, lastCursor.ID, in.PageSize); err != nil {
		return nil, err
	}

	return &out, nil
}

var qListRootDocuments = dqb.Str(`
	SELECT
		id,
		iri
	FROM resources
	WHERE id < :last_cursor
	AND iri NOT GLOB 'hm://*/**'
	ORDER BY id DESC
	LIMIT :page_size + 1;
`)

// ListDocuments implements Documents API v3.
func (srv *Server) ListDocuments(ctx context.Context, in *documents.ListDocumentsRequest) (*documents.ListDocumentsResponse, error) {
	{
		if in.Namespace == "" {
			return nil, errutil.MissingArgument("namespace")
		}
	}

	ns, err := core.DecodePrincipal(in.Namespace)
	if err != nil {
		return nil, fmt.Errorf("failed to decode namespace: %w", err)
	}

	type Cursor struct {
		ID int64 `json:"i"`
	}

	var (
		count      int32
		lastCursor = Cursor{
			ID: math.MaxInt64,
		}
	)

	if in.PageSize <= 0 {
		in.PageSize = 30
	}

	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &lastCursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	out := documents.ListDocumentsResponse{
		Documents: make([]*documents.DocumentListItem, 0, in.PageSize),
	}

	namespaceGlob := "hm://" + ns.String() + "*"

	if err = sqlitex.Exec(conn, qListDocuments(), func(stmt *sqlite.Stmt) error {
		if count == in.PageSize {
			var err error
			out.NextPageToken, err = apiutil.EncodePageToken(lastCursor, nil)
			return err
		}
		count++

		var (
			id  = stmt.ColumnInt64(0)
			iri = stmt.ColumnText(1)
		)

		lastCursor.ID = id

		// TODO(burdiyan): This is a hack to get the namespace from the IRI.
		u, err := url.Parse(iri)
		if err != nil {
			return err
		}

		path := u.Path

		doc, err := srv.GetDocument(ctx, &documents.GetDocumentRequest{
			Namespace: u.Host,
			Path:      path,
		})
		if err != nil {
			return err
		}

		// TODO: use indexed data instead of loading the entire document.
		out.Documents = append(out.Documents, DocumentToListItem(doc))

		return nil
	}, lastCursor.ID, namespaceGlob, in.PageSize); err != nil {
		return nil, err
	}

	return &out, nil
}

var qListDocuments = dqb.Str(`
	SELECT
		id,
		iri
	FROM resources
	WHERE id < :last_cursor
	AND iri GLOB :namespace_glob
	ORDER BY id DESC
	LIMIT :page_size + 1;
`)

// DeleteDocument implements Documents API v3.
func (srv *Server) DeleteDocument(ctx context.Context, in *documents.DeleteDocumentRequest) (*emptypb.Empty, error) {
	return nil, status.Error(codes.Unimplemented, "DeleteDocument is not implemented yet")
}

func (srv *Server) ensureProfileGenesis(ctx context.Context, kp core.KeyPair) error {
	ebc, err := index.NewChange(kp, nil, "Create", nil, index.ProfileGenesisEpoch)
	if err != nil {
		return err
	}

	iri, err := makeIRI(kp.Principal(), "")
	if err != nil {
		return err
	}

	ebr, err := index.NewRef(kp, ebc.CID, iri, []cid.Cid{ebc.CID}, index.ProfileGenesisEpoch)
	if err != nil {
		return err
	}

	if err := srv.idx.PutMany(ctx, []blocks.Block{ebc, ebr}); err != nil {
		return err
	}

	return nil
}

func makeIRI(namespace core.Principal, path string) (index.IRI, error) {
	if path != "" {
		if path[0] != '/' {
			return "", fmt.Errorf("path must start with a slash: %s", path)
		}

		if path[len(path)-1] == '/' {
			return "", fmt.Errorf("path must not end with a slash: %s", path)
		}
	}

	return index.IRI("hm://" + namespace.String() + path), nil
}

func (srv *Server) loadDocument(ctx context.Context, namespace core.Principal, path string, ensurePath bool) (*docmodel.Document, error) {
	iri, err := makeIRI(namespace, path)
	if err != nil {
		return nil, err
	}

	clock := hlc.NewClock()
	entity := docmodel.NewEntityWithClock(iri, clock)
	if err := srv.idx.WalkChanges(ctx, iri, namespace, func(c cid.Cid, ch *index.Change) error {
		return entity.ApplyChange(c, ch)
	}); err != nil {
		return nil, err
	}

	if !ensurePath && len(entity.Heads()) == 0 {
		return nil, status.Errorf(codes.NotFound, "document not found: %s", iri)
	}

	doc, err := docmodel.New(entity, clock.MustNow())
	if err != nil {
		return nil, err
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
		default:
			return status.Errorf(codes.Unimplemented, "unknown operation %T", o)
		}
	}

	return nil
}

func (srv *Server) checkWriteAccess(_ context.Context, namespace core.Principal, _ string, kp core.KeyPair) error {
	if namespace.Equal(kp.Principal()) {
		return nil
	}

	// TODO(burdiyan): check capability delegations.
	return status.Errorf(codes.PermissionDenied, "key %s is not allowed to edit namespace %s", kp.Principal(), namespace)
}

// DocumentToListItem converts a document to a document list item.
func DocumentToListItem(doc *documents.Document) *documents.DocumentListItem {
	return &documents.DocumentListItem{
		Namespace:  doc.Namespace,
		Path:       doc.Path,
		Metadata:   doc.Metadata,
		Authors:    doc.Authors,
		CreateTime: doc.CreateTime,
		UpdateTime: doc.UpdateTime,
		Version:    doc.Version,
	}
}
