// Package documents implements Documents API v2.
package documents

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"seed/backend/core"
	"seed/backend/daemon/api/documents/v2alpha/docmodel"
	"seed/backend/daemon/apiutil"
	"seed/backend/daemon/index"
	documents "seed/backend/genproto/documents/v2alpha"
	"seed/backend/hlc"
	"seed/backend/pkg/dqb"
	"strings"

	"crawshaw.io/sqlite"
	"crawshaw.io/sqlite/sqlitex"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server implements Documents API v2.
type Server struct {
	documents.UnimplementedDocumentsServer

	keys core.KeyStore
	idx  *index.Index
	db   *sqlitex.Pool
}

// NewServer creates a new Documents API v2 server.
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

func (srv *Server) GetDocument(ctx context.Context, in *documents.GetDocumentRequest) (*documents.Document, error) {
	rid, err := parseResourceID(in.DocumentId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid document ID %s: %v", in.DocumentId, err)
	}

	if in.Version != "" {
		return nil, status.Error(codes.Unimplemented, "getting docs by version is not implemented yet")
	}

	if rid.Path == "" && rid.Type == resourceTypeAccount {
		return srv.GetProfileDocument(ctx, &documents.GetProfileDocumentRequest{
			AccountId: rid.UID,
			Version:   in.Version,
		})
	}

	if rid.Type != resourceTypeAccount {
		return nil, status.Errorf(codes.Unimplemented, "only profiles and profile subdocs are implemented now, requested: %s", in.DocumentId)
	}

	rootAcc, err := core.DecodePrincipal(rid.UID)
	if err != nil {
		return nil, err
	}

	if rid.Path != "" {
		// Load parent document.
		clock := hlc.NewClock()
		e := docmodel.NewEntityWithClock(rid.ParentIRI(), clock)

		if err := srv.idx.WalkChanges(ctx, rid.ParentIRI(), rootAcc, func(c cid.Cid, ch *index.Change) error {
			return e.ApplyChange(c, ch)
		}); err != nil {
			return nil, err
		}

		v, ok := e.Get("index", rid.Path)
		if !ok || v == nil {
			return nil, status.Errorf(codes.NotFound, "subdocument '%s' not found for parent '%s'", rid.Path, rid.ParentIRI())
		}

		var heads []cid.Cid
		{
			vv, ok := v.([]any)
			if !ok {
				return nil, status.Errorf(codes.Internal, "invalid index heads type: %T", v)
			}

			heads = make([]cid.Cid, len(vv))
			for i, v := range vv {
				heads[i], ok = v.(cid.Cid)
				if !ok {
					return nil, fmt.Errorf("head is not a CID: %v", v)
				}
			}
		}

		if len(heads) == 0 {
			return nil, status.Errorf(codes.NotFound, "subdocument '%s' for parent '%s' has empty heads", rid.Path, rid.ParentIRI())
		}

		// Load subdocument.
		{
			clock := hlc.NewClock()
			e := docmodel.NewEntityWithClock(rid.IRI(), clock)

			if err := srv.idx.WalkChangesFromHeads(ctx, rid.IRI(), heads, func(c cid.Cid, ch *index.Change) error {
				return e.ApplyChange(c, ch)
			}); err != nil {
				return nil, err
			}

			subdoc, err := docmodel.New(e, clock.MustNow())
			if err != nil {
				return nil, err
			}

			return subdoc.Hydrate(ctx)
		}
	}

	return nil, status.Error(codes.Unimplemented, "getting standalone documents is not supported yet")
}

func (srv *Server) GetProfileDocument(ctx context.Context, in *documents.GetProfileDocumentRequest) (*documents.Document, error) {
	if in.Version != "" {
		// TODO(hm24): Implement this.
		return nil, status.Errorf(codes.Unimplemented, "getting profile document by version is not implemented yet")
	}

	if in.AccountId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "account_id is required")
	}

	// Extract the ID if it's a full IRI.
	in.AccountId = strings.TrimPrefix(in.AccountId, "hm://a/")

	acc, err := core.DecodePrincipal(in.AccountId)
	if err != nil {
		return nil, err
	}

	adoc := index.IRI("hm://a/" + acc.String())

	clock := hlc.NewClock()
	e := docmodel.NewEntityWithClock(index.IRI("hm://a/"+acc.String()), clock)

	if err := srv.idx.WalkChanges(ctx, adoc, acc, func(c cid.Cid, ch *index.Change) error {
		return e.ApplyChange(c, ch)
	}); err != nil {
		return nil, err
	}

	doc, err := docmodel.New(e, clock.MustNow())
	if err != nil {
		return nil, err
	}

	return doc.Hydrate(ctx)
}

type resourceID struct {
	Type byte // a or d
	UID  string
	Path string
}

const (
	resourceTypeAccount  = 'a'
	resourceTypeDocument = 'd'
)

func (rid resourceID) ParentString() string {
	return "hm://" + string(rid.Type) + "/" + rid.UID
}

func (rid resourceID) ParentIRI() index.IRI {
	return index.IRI(rid.ParentString())
}

func (rid resourceID) IRI() index.IRI {
	return index.IRI(rid.String())
}

func (rid resourceID) String() string {
	var sb strings.Builder
	sb.WriteString("hm://")
	sb.WriteByte(rid.Type)
	sb.WriteByte('/')
	sb.WriteString(rid.UID)
	if rid.Path != "" {
		sb.WriteByte('/')
		sb.WriteString(rid.Path)
	}
	return sb.String()
}

var (
	groupType = getGroupID("type")
	groupUID  = getGroupID("uid")
	groupPath = getGroupID("path")
)

func getGroupID(groupName string) int {
	idx := resourceIDRegexp.SubexpIndex(groupName)
	if idx <= 0 {
		panic("BUG: no such regex group name: " + groupName)
	}

	return idx
}

func parseResourceID(raw string) (rid resourceID, err error) {
	matches := resourceIDRegexp.FindStringSubmatch(raw)
	if matches == nil {
		return resourceID{}, fmt.Errorf("resource ID '%s' doesn't match the regexp '%s'", raw, resourceIDRegexp)
	}

	rid = resourceID{
		Type: matches[groupType][0],
		UID:  matches[groupUID],
		Path: matches[groupPath],
	}

	return rid, err
}

var resourceIDRegexp = regexp.MustCompile(`^(?P<scheme>hm:\/\/)?(?P<type>a|d)\/(?P<uid>[a-zA-Z0-9]+)(?:\/(?P<path>[a-zA-Z0-9\-._~!$&'()*+,;=:@]+))?$`)

// CreateDocumentChange implements Documents API v2.
func (srv *Server) CreateDocumentChange(ctx context.Context, in *documents.CreateDocumentChangeRequest) (*documents.Document, error) {

	if in.DocumentId == "" {
		return nil, status.Errorf(codes.Unimplemented, "TODO: creating document changes without document ID is not implemented yet")
	}

	if in.SigningKeyName == "" {
		return nil, status.Errorf(codes.InvalidArgument, "signing_key_name is required")
	}

	rid, err := parseResourceID(in.DocumentId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid document ID: %v", err)
	}

	if (rid.Type != resourceTypeAccount && rid.Path == "") && in.DocumentId != "" && in.BaseVersion == "" {
		return nil, status.Errorf(codes.InvalidArgument, "base_version is required when document_id is provided")
	}

	if rid.Type == resourceTypeAccount && rid.Path == "" {
		return srv.ChangeProfileDocument(ctx, &documents.ChangeProfileDocumentRequest{
			AccountId: rid.UID,
			Changes:   in.Changes,
		})
	}

	if rid.Path == "" {
		return nil, status.Errorf(codes.Unimplemented, "TODO: only creating subdocuments is supported for now: %s", in.DocumentId)
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	// TODO: implement updating subdocs. Currently can only create new.
	if _, err := srv.idx.CanEditResource(ctx, rid.IRI(), kp.Principal()); err == nil {
		return nil, status.Errorf(codes.Unimplemented, "TODO: updating existing subdocuments is not implemented yet")
	}

	ok, err := srv.idx.CanEditResource(ctx, rid.ParentIRI(), kp.Principal())
	if err != nil {
		if s, ok := status.FromError(err); ok && s.Code() == codes.NotFound {
			return nil, status.Errorf(codes.NotFound, "parent document '%s' is not found to create subdocument '%s'", rid.ParentIRI(), rid.Path)
		}

		return nil, err
	}

	if !ok {
		return nil, status.Errorf(codes.PermissionDenied, "account %s is not allowed to edit document %s", kp.Principal(), in.DocumentId)
	}

	clock := hlc.NewClock()
	e := docmodel.NewEntityWithClock(rid.IRI(), clock)
	doc, err := docmodel.New(e, clock.MustNow())
	if err != nil {
		return nil, err
	}

	if err := applyChanges(doc, in.Changes); err != nil {
		return nil, err
	}

	subChange, err := doc.Change(kp)
	if err != nil {
		return nil, fmt.Errorf("failed to create subdoc change: %w", err)
	}

	// Store subdoc head in the parent's index.
	var parentVersion docmodel.Version
	{
		pe := docmodel.NewEntityWithClock(rid.ParentIRI(), clock)
		if err := srv.idx.WalkChanges(ctx, rid.ParentIRI(), kp.Principal(), func(c cid.Cid, ch *index.Change) error {
			return pe.ApplyChange(c, ch)
		}); err != nil {
			return nil, fmt.Errorf("failed to load parent document: %w", err)
		}

		pdoc, err := docmodel.New(pe, clock.MustNow())
		if err != nil {
			return nil, fmt.Errorf("failed to init parent document: %w", err)
		}

		if err := pdoc.SetIndexHeads(rid.Path, []cid.Cid{subChange.CID}); err != nil {
			return nil, fmt.Errorf("failed to set index heads: %w", err)
		}

		parentChange, err := pdoc.Change(kp)
		if err != nil {
			return nil, fmt.Errorf("failed to create parent document change: %w", err)
		}

		parentRef, err := pdoc.Ref(kp)
		if err != nil {
			return nil, fmt.Errorf("failed to create parent ref: %w", err)
		}

		if err := srv.idx.PutMany(ctx, []blocks.Block{subChange, parentChange, parentRef}); err != nil {
			return nil, fmt.Errorf("failed to put blocks", err)
		}

		parentVersion = pdoc.Entity().Version()
	}

	_ = parentVersion // TODO: get the document by version.
	return srv.GetDocument(ctx, &documents.GetDocumentRequest{
		DocumentId: in.DocumentId,
		// Version:    parentVersion.String(),
	})
}

// ChangeProfileDocument implements Documents API v2.
func (srv *Server) ChangeProfileDocument(ctx context.Context, in *documents.ChangeProfileDocumentRequest) (*documents.Document, error) {
	if in.AccountId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "account_id is required")
	}

	if len(in.Changes) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "at least one change is required")
	}

	acc, err := core.DecodePrincipal(in.AccountId)
	if err != nil {
		return nil, err
	}

	kp, err := srv.getKey(ctx, acc)
	if err != nil {
		return nil, err
	}

	adoc := index.IRI("hm://a/" + acc.String())

	if err := srv.ensureProfileGenesis(ctx, kp); err != nil {
		return nil, err
	}

	clock := hlc.NewClock()
	e := docmodel.NewEntityWithClock(index.IRI("hm://a/"+acc.String()), clock)

	if err := srv.idx.WalkChanges(ctx, adoc, acc, func(c cid.Cid, ch *index.Change) error {
		return e.ApplyChange(c, ch)
	}); err != nil {
		return nil, err
	}

	doc, err := docmodel.New(e, clock.MustNow())
	if err != nil {
		return nil, err
	}

	if err := applyChanges(doc, in.Changes); err != nil {
		return nil, err
	}

	if _, err := doc.Commit(ctx, kp, srv.idx); err != nil {
		return nil, err
	}

	return srv.GetProfileDocument(ctx, &documents.GetProfileDocumentRequest{
		AccountId: in.AccountId,
	})
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
		case *documents.DocumentChange_SetIndex_:
			return status.Errorf(codes.Unimplemented, "setting index is not implemented yet")
		case *documents.DocumentChange_UpdateMember_:
			return status.Errorf(codes.InvalidArgument, "updating members is not supported on profile documents")
		default:
			return status.Errorf(codes.Unimplemented, "unknown operation %T", o)
		}
	}

	return nil
}

var qListProfileDocuments = dqb.Str(`
	SELECT
		iri,
		id
	FROM resources 
	WHERE id < :last_cursor
	ORDER BY id DESC LIMIT :page_size + 1;
`)

// ListProfileDocuments implements Documents API v2.
func (srv *Server) ListProfileDocuments(ctx context.Context, in *documents.ListProfileDocumentsRequest) (*documents.ListProfileDocumentsResponse, error) {
	out := documents.ListProfileDocumentsResponse{
		Documents: []*documents.Document{},
	}

	conn, cancel, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	type Cursor struct {
		ID       int64  `json:"i"`
		Resource string `json:"r"`
	}
	var (
		count      int32
		lastCursor Cursor
	)
	if in.PageSize <= 0 {
		in.PageSize = 30
	}
	if in.PageToken == "" {
		lastCursor.ID = math.MaxInt64
		lastCursor.Resource = string([]rune{0xFFFF}) // Max string.
	} else {
		if err := apiutil.DecodePageToken(in.PageToken, &lastCursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}
	if err = sqlitex.Exec(conn, qListProfileDocuments(), func(stmt *sqlite.Stmt) error {
		if count == in.PageSize {
			var err error
			out.NextPageToken, err = apiutil.EncodePageToken(lastCursor, nil)
			return err
		}
		count++

		var (
			iri = stmt.ColumnText(0)
			id  = stmt.ColumnInt64(1)
		)
		acc := strings.Trim(iri, "hm://a/")
		lastCursor.ID = id
		lastCursor.Resource = acc
		doc, err := srv.GetProfileDocument(ctx, &documents.GetProfileDocumentRequest{
			AccountId: acc,
		})
		if err != nil {
			return err
		}
		out.Documents = append(out.Documents, doc)

		return nil
	}, lastCursor.ID, in.PageSize); err != nil {
		return nil, err
	}

	return &out, nil

}

func (srv *Server) getKey(ctx context.Context, account core.Principal) (kp core.KeyPair, err error) {
	// TODO(hm24): This is a hack here.
	// We don't have a way to get a key by account ID.
	// This call should either accept a key name, or get rid of this idea.
	keys, err := srv.keys.ListKeys(ctx)
	if err != nil {
		return core.KeyPair{}, err
	}

	var found bool
	for _, k := range keys {
		if k.PublicKey.Equal(account) {
			kp, err = srv.keys.GetKey(ctx, k.Name)
			if err != nil {
				return core.KeyPair{}, err
			}
			found = true
			break
		}
	}

	if !found {
		return core.KeyPair{}, status.Errorf(codes.NotFound, "there's no private key for the specified account ID %s", account)
	}

	return kp, nil
}

func (srv *Server) ensureProfileGenesis(ctx context.Context, kp core.KeyPair) error {
	ebc, err := index.NewChange(kp, nil, "Create", nil, index.ProfileGenesisEpoch)
	if err != nil {
		return err
	}

	ebr, err := index.NewRef(kp, ebc.CID, index.IRI("hm://a/"+kp.Principal().String()), []cid.Cid{ebc.CID}, index.ProfileGenesisEpoch)
	if err != nil {
		return err
	}

	if err := srv.idx.PutMany(ctx, []blocks.Block{ebc, ebr}); err != nil {
		return err
	}

	return nil
}
