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
		return resourceID{}, fmt.Errorf("invalid resource ID: %q", raw)
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
		return nil, status.Errorf(codes.Unimplemented, "creating document changes without document ID is not implemented yet")
	}

	if strings.HasPrefix(in.DocumentId, "hm://a/") {
		return srv.ChangeProfileDocument(ctx, &documents.ChangeProfileDocumentRequest{
			AccountId: in.DocumentId,
			Changes:   in.Changes,
		})
	}

	panic("TODO")
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

	for _, op := range in.Changes {
		switch o := op.Op.(type) {
		case *documents.DocumentChange_SetMetadata_:
			if err := doc.SetMetadata(o.SetMetadata.Key, o.SetMetadata.Value); err != nil {
				return nil, err
			}
		case *documents.DocumentChange_MoveBlock_:
			if err := doc.MoveBlock(o.MoveBlock.BlockId, o.MoveBlock.Parent, o.MoveBlock.LeftSibling); err != nil {
				return nil, err
			}
		case *documents.DocumentChange_DeleteBlock:
			if err := doc.DeleteBlock(o.DeleteBlock); err != nil {
				return nil, err
			}
		case *documents.DocumentChange_ReplaceBlock:
			if err := doc.ReplaceBlock(o.ReplaceBlock); err != nil {
				return nil, err
			}
		case *documents.DocumentChange_SetIndex_:
			return nil, status.Errorf(codes.Unimplemented, "setting index is not implemented yet")
		case *documents.DocumentChange_UpdateMember_:
			return nil, status.Errorf(codes.InvalidArgument, "updating members is not supported on profile documents")
		default:
			return nil, status.Errorf(codes.Unimplemented, "unknown operation %T", o)
		}
	}

	if _, err := doc.Commit(ctx, kp, srv.idx); err != nil {
		return nil, err
	}

	return srv.GetProfileDocument(ctx, &documents.GetProfileDocumentRequest{
		AccountId: in.AccountId,
	})
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
