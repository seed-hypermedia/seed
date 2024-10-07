// Package documents implements Documents API v3.
package documents

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/apiutil"
	"seed/backend/util/cclock"
	"seed/backend/util/dqb"
	"seed/backend/util/errutil"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
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

	doc, err := srv.loadDocument(ctx, ns, in.Path, docmodel.Version(in.Version), false)
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

	var capc cid.Cid
	if in.Capability != "" {
		capc, err = cid.Decode(in.Capability)
		if err != nil {
			return nil, err
		}
	}

	if err := srv.checkWriteAccess(ctx, ns, in.Path, kp, capc); err != nil {
		return nil, err
	}

	if in.Path == "" {
		if err := srv.ensureProfileGenesis(ctx, kp); err != nil {
			return nil, err
		}
	}

	ver := docmodel.Version(in.BaseVersion)

	doc, err := srv.loadDocument(ctx, ns, in.Path, ver, true)
	if err != nil {
		return nil, err
	}

	if in.BaseVersion == "" {
		switch {
		// No base version is allowed for home documents with 1 change (which is the auto-generated genesis change).
		case in.Path == "" && doc.NumChanges() == 1:
		// No base version is allowed for newly created documents, i.e. when there's not changes applied yet.
		case in.Path != "" && doc.NumChanges() == 0:
		// Otherwise it's an error to not provide a base version.
		default:
			return nil, status.Errorf(codes.InvalidArgument, "base_version is required for updating existing documents")
		}
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
		Account: in.Account,
		Path:    in.Path,
		Version: docChange.CID.String(),
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
		in.PageSize = 100
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
			Account: ns.String(),
			Path:    "",
		})
		if err != nil {
			srv.log.Warn("Partial root document. Possibly got the genesis blob but not the content due to not syncing parent document", zap.Error(err))
			return nil
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
	LIMIT :page_size;
`)

// ListDocuments implements Documents API v3.
func (srv *Server) ListDocuments(ctx context.Context, in *documents.ListDocumentsRequest) (*documents.ListDocumentsResponse, error) {
	{
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}
	}

	ns, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, fmt.Errorf("failed to decode account: %w", err)
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

		// TODO(burdiyan): This is a hack to get the account from the IRI.
		u, err := url.Parse(iri)
		if err != nil {
			return err
		}

		path := u.Path

		doc, err := srv.GetDocument(ctx, &documents.GetDocumentRequest{
			Account: u.Host,
			Path:    path,
		})
		if err != nil {
			return nil
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
	ebc, err := blob.NewChange(kp, cid.Undef, nil, 0, nil, blob.ProfileGenesisEpoch)
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

	ebr, err := blob.NewRef(kp, ebc.CID, space, path, []cid.Cid{ebc.CID}, blob.ProfileGenesisEpoch)
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

func (srv *Server) loadDocument(ctx context.Context, account core.Principal, path string, version docmodel.Version, ensurePath bool) (*docmodel.Document, error) {
	iri, err := makeIRI(account, path)
	if err != nil {
		return nil, err
	}

	clock := cclock.New()
	doc, err := docmodel.New(iri, clock)
	if err != nil {
		return nil, err
	}

	var outErr error
	changes, check := srv.idx.IterChanges(ctx, iri, account)
	for _, ch := range changes {
		if err := doc.ApplyChange(ch.CID, ch.Data); err != nil {
			outErr = errors.Join(outErr, err)
			break
		}
	}
	outErr = errors.Join(outErr, check())
	if outErr != nil {
		return nil, outErr
	}

	if !ensurePath && len(doc.Heads()) == 0 {
		return nil, status.Errorf(codes.NotFound, "document not found: %s", iri)
	}

	if version != "" {
		heads, err := version.Parse()
		if err != nil {
			return nil, err
		}

		doc, err = doc.Checkout(heads)
		if err != nil {
			return nil, fmt.Errorf("failed to checkout version: %w", err)
		}
	}

	return doc, err
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

func (srv *Server) checkWriteAccess(ctx context.Context, account core.Principal, path string, kp core.KeyPair, capc cid.Cid) error {
	if account.Equal(kp.Principal()) {
		return nil
	}

	if !capc.Defined() {
		return status.Errorf(codes.PermissionDenied, "key %s is not allowed to edit account %s", kp.Principal(), account)
	}

	blk, err := srv.idx.Get(ctx, capc)
	if err != nil {
		return err
	}

	cpb := &blob.Capability{}
	if err := cbornode.DecodeInto(blk.RawData(), cpb); err != nil {
		return err
	}

	if !cpb.Space.Equal(account) {
		return status.Errorf(codes.PermissionDenied, "capability %s is not from account %s", capc, account)
	}

	if !cpb.Delegate.Equal(kp.Principal()) {
		return status.Errorf(codes.PermissionDenied, "capability %s is not delegated to key %s", capc, kp.Principal())
	}

	grantedIRI, err := makeIRI(cpb.Space, cpb.Path)
	if err != nil {
		return err
	}

	wantIRI, err := makeIRI(account, path)
	if err != nil {
		return err
	}

	if !(wantIRI >= grantedIRI && wantIRI < grantedIRI+"~~~~~~~") {
		return status.Errorf(codes.PermissionDenied, "capability %s grants path '%s' which doesn't cover '%s'", capc, grantedIRI, wantIRI)
	}

	if documents.Role(documents.Role_value[cpb.Role]) != documents.Role_WRITER {
		return status.Errorf(codes.PermissionDenied, "capability role %s is not allowed to write", cpb.Role)
	}

	return nil
}

// DocumentToListItem converts a document to a document list item.
func DocumentToListItem(doc *documents.Document) *documents.DocumentListItem {
	return &documents.DocumentListItem{
		Account:    doc.Account,
		Path:       doc.Path,
		Metadata:   doc.Metadata,
		Authors:    doc.Authors,
		CreateTime: doc.CreateTime,
		UpdateTime: doc.UpdateTime,
		Version:    doc.Version,
	}
}
