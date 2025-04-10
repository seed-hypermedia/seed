// Package entities implements the Entities API.
package entities

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"seed/backend/blob"
	"seed/backend/core"
	entities "seed/backend/genproto/entities/v1alpha"
	"seed/backend/hlc"
	"seed/backend/util/dqb"
	"seed/backend/util/errutil"
	"strings"
	"sync"
	"time"

	"github.com/ipfs/go-cid"

	"github.com/sahilm/fuzzy"
	"google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"google.golang.org/grpc"
)

// Discoverer is an interface for discovering objects.
type Discoverer interface {
	DiscoverObject(ctx context.Context, i blob.IRI, v blob.Version, recursive bool) (blob.Version, error)
}

// Server implements Entities API.
type Server struct {
	entities.UnimplementedEntitiesServer

	idx  *blob.Index
	disc Discoverer

	mu             sync.Mutex
	discoveryTasks map[discoveryTaskKey]*discoveryTask
}

// NewServer creates a new entities server.
func NewServer(idx *blob.Index, disc Discoverer) *Server {
	return &Server{
		idx:            idx,
		disc:           disc,
		discoveryTasks: make(map[discoveryTaskKey]*discoveryTask),
	}
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	entities.RegisterEntitiesServer(rpc, srv)
}

const (
	lastResultTTL = time.Second * 20 // we cache the previous discovery result for this long
	taskTTL       = time.Second * 40 // if the frontend didn't request discovery for this long we discard the task
)

// DiscoverEntity implements the Entities server.
func (api *Server) DiscoverEntity(ctx context.Context, in *entities.DiscoverEntityRequest) (*entities.DiscoverEntityResponse, error) {
	if api.disc == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "discovery is not enabled")
	}

	if in.Account == "" {
		return nil, errutil.MissingArgument("account")
	}

	in.Account = strings.TrimPrefix(in.Account, "hm://")
	in.Path = strings.TrimSuffix(in.Path, "/")

	acc, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "bad account: %v", err)
	}

	iri, err := blob.NewIRI(acc, in.Path)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "bad IRI: %v", err)
	}

	if _, err := blob.Version(in.Version).Parse(); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid version %q: %v", in.Version, err)
	}

	v := blob.Version(in.Version)

	dkey := discoveryTaskKey{
		IRI:       iri,
		Version:   v,
		Recursive: in.Recursive,
	}

	now := time.Now()

	var task *discoveryTask
	api.mu.Lock()
	task = api.discoveryTasks[dkey]
	if task == nil {
		task = &discoveryTask{
			key:          dkey,
			createTime:   now,
			callCount:    1,
			lastCallTime: now,
		}
		api.discoveryTasks[dkey] = task
		go task.start(api)
		api.mu.Unlock()
		return &entities.DiscoverEntityResponse{}, nil
	}
	api.mu.Unlock()

	task.mu.Lock()
	defer task.mu.Unlock()

	task.callCount++
	task.lastCallTime = now

	return &entities.DiscoverEntityResponse{
		Version: task.lastResult.String(),
	}, task.lastErr
}

type discoveryTaskKey struct {
	IRI       blob.IRI
	Version   blob.Version
	Recursive bool
}

type discoveryTask struct {
	mu sync.Mutex

	key            discoveryTaskKey
	createTime     time.Time
	callCount      int
	lastCallTime   time.Time
	lastResultTime time.Time
	lastResult     blob.Version
	lastErr        error
}

func (task *discoveryTask) start(api *Server) {
	for {
		res, err := api.disc.DiscoverObject(context.Background(), task.key.IRI, task.key.Version, task.key.Recursive)
		now := time.Now()
		task.mu.Lock()
		task.lastResultTime = now
		task.lastResult = res
		task.lastErr = err
		task.mu.Unlock()

		time.Sleep(lastResultTTL)

		// If the frontend keeps periodically calling discovery,
		// we want to keep this loop running.
		task.mu.Lock()
		if time.Since(task.lastCallTime) <= taskTTL {
			task.mu.Unlock()
			continue
		}

		// If the frontend stops calling discovery periodically,
		// we want to stop this loop and remove the task from the map,
		// to avoid the map growing boundlessly.
		api.mu.Lock()
		delete(api.discoveryTasks, task.key)
		task.mu.Unlock()
		api.mu.Unlock()
		return
	}
}

var qGetMetadata = dqb.Str(`
	select dg.metadata, r.iri, pk.principal from document_generations dg 
	INNER JOIN resources r ON r.id = dg.resource 
	INNER JOIN public_keys pk ON pk.id = r.owner
	WHERE dg.is_deleted = False;`)

var qGetParentsMetadata = dqb.Str(`
	select dg.metadata, r.iri from document_generations dg 
	INNER JOIN resources r ON r.id = dg.resource 
	WHERE dg.is_deleted = False AND r.iri GLOB :iriGlob;`)

// SearchEntities implements the Fuzzy search of entities.
func (srv *Server) SearchEntities(ctx context.Context, in *entities.SearchEntitiesRequest) (*entities.SearchEntitiesResponse, error) {
	var names []string
	var icons []string
	var iris []string
	var owners []string
	var limit = 30
	type value struct {
		Value string `json:"v"`
	}
	type title struct {
		Name value `json:"name"`
	}
	type icon struct {
		Icon value `json:"icon"`
	}
	if err := srv.idx.Query(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qGetMetadata(), func(stmt *sqlite.Stmt) error {
			var title title
			var icon icon
			if err := json.Unmarshal(stmt.ColumnBytes(0), &title); err != nil {
				return nil
			}
			names = append(names, title.Name.Value)
			if err := json.Unmarshal(stmt.ColumnBytes(0), &icon); err != nil {
				return nil
			}
			icons = append(icons, icon.Icon.Value)
			iris = append(iris, stmt.ColumnText(1))
			ownerID := core.Principal(stmt.ColumnBytes(2)).String()
			owners = append(owners, ownerID)
			return nil
		})
	}); err != nil {
		return nil, err
	}
	matches := fuzzy.Find(in.Query, names)
	matchingEntities := []*entities.Entity{}
	for i, match := range matches {
		if match.Score < 0 {
			limit++
			continue
		}
		if i >= limit {
			break
		}
		parents := make(map[string]interface{})
		breadcrum := strings.Split(strings.TrimPrefix(iris[match.Index], "hm://"), "/")
		var root string
		for i, _ := range breadcrum {
			parents["hm://"+strings.Join(breadcrum[:i+1], "/")] = nil
			if i == 0 {
				root = "hm://" + strings.Join(breadcrum[:i+1], "") + "*"
			}
		}
		var parentTitles []string
		if err := srv.idx.Query(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, qGetParentsMetadata(), func(stmt *sqlite.Stmt) error {
				var title title
				iri := stmt.ColumnText(1)
				if _, ok := parents[iri]; !ok {
					return nil
				}
				if err := json.Unmarshal(stmt.ColumnBytes(0), &title); err != nil {
					return nil
				}
				if title.Name.Value == match.Str {
					return nil
				}
				parentTitles = append(parentTitles, title.Name.Value)
				iris = append(iris, iri)
				ownerID := core.Principal(stmt.ColumnBytes(2)).String()
				owners = append(owners, ownerID)
				return nil
			}, root)
		}); err != nil {
			return nil, err
		}
		matchingEntities = append(matchingEntities, &entities.Entity{
			Id:          iris[match.Index],
			Title:       match.Str,
			ParentNames: parentTitles,
			Icon:        icons[match.Index],
			Owner:       owners[match.Index]})
		fmt.Println("Entity ID: ", iris[match.Index])

	}
	return &entities.SearchEntitiesResponse{Entities: matchingEntities}, nil
}

// DeleteEntity implements the corresponding gRPC method.
// func (api *Server) DeleteEntity(ctx context.Context, in *entities.DeleteEntityRequest) (*emptypb.Empty, error) {
// 	var meta string
// 	var qGetResourceMetadata = dqb.Str(`
//   	SELECT meta from meta_view
// 	WHERE iri = :eid
// 	`)

// 	if in.Id == "" {
// 		return nil, status.Errorf(codes.InvalidArgument, "must specify entity ID to delete")
// 	}

// 	eid := hyper.EntityID(in.Id)

// 	err := api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		return sqlitex.Exec(conn, qGetResourceMetadata(), func(stmt *sqlite.Stmt) error {
// 			meta = stmt.ColumnText(0)
// 			return nil
// 		}, in.Id)
// 	})
// 	if err != nil {
// 		return nil, err
// 	}
// 	err = api.blobs.ForEachComment(ctx, eid.String(), func(c cid.Cid, cmt hyper.Comment, conn *sqlite.Conn) error {
// 		referencedDocument := strings.Split(cmt.Target, "?v=")[0]
// 		if referencedDocument == eid.String() {
// 			_, err = hypersql.BlobsDelete(conn, c.Hash())
// 			if err != nil {
// 				if err = hypersql.BlobsEmptyByHash(conn, c.Hash()); err != nil {
// 					return err
// 				}
// 			}
// 			if cmt.RepliedComment.String() != "" {
// 				_, err = hypersql.BlobsDelete(conn, cmt.RepliedComment.Hash())
// 				if err != nil {
// 					if err = hypersql.BlobsEmptyByHash(conn, cmt.RepliedComment.Hash()); err != nil {
// 						return err
// 					}
// 				}
// 			}

// 			return nil
// 		}
// 		return nil
// 	})

// 	err = api.blobs.DeleteEntity(ctx, eid)
// 	if err != nil {
// 		if errors.Is(err, hyper.ErrEntityNotFound) {
// 			return nil, err
// 		}

// 		_, err = &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 			return hypersql.BlobsEmptyByEID(conn, in.Id)
// 		})
// 		if err != nil {
// 			return &emptypb.Empty{}, err
// 		}

// 		_, err = &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 			return hypersql.BlobsStructuralDelete(conn, in.Id)
// 		})
// 		if err != nil {
// 			return &emptypb.Empty{}, err
// 		}
// 	}
// 	_, err = &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		return sqlitex.WithTx(conn, func() error {
// 			res, err := hypersql.EntitiesInsertRemovedRecord(conn, eid.String(), in.Reason, meta)
// 			if err != nil {
// 				return err
// 			}
// 			if res.ResourceEID != eid.String() {
// 				return fmt.Errorf("%w: %s", hyper.ErrEntityNotFound, eid)
// 			}

// 			return nil
// 		})
// 	})
// 	return &emptypb.Empty{}, err
// }

// // UndeleteEntity implements the corresponding gRPC method.
// func (api *Server) UndeleteEntity(ctx context.Context, in *entities.UndeleteEntityRequest) (*emptypb.Empty, error) {
// 	if in.Id == "" {
// 		return nil, status.Errorf(codes.InvalidArgument, "must specify entity ID to restore")
// 	}

// 	eid := hyper.EntityID(in.Id)

// 	return &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		return hypersql.EntitiesDeleteRemovedRecord(conn, eid.String())
// 	})
// }

// // ListDeletedEntities implements the corresponding gRPC method.
// func (api *Server) ListDeletedEntities(ctx context.Context, _ *entities.ListDeletedEntitiesRequest) (*entities.ListDeletedEntitiesResponse, error) {
// 	resp := &entities.ListDeletedEntitiesResponse{
// 		DeletedEntities: make([]*entities.DeletedEntity, 0),
// 	}

// 	err := api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		list, err := hypersql.EntitiesListRemovedRecords(conn)
// 		if err != nil {
// 			return err
// 		}
// 		for _, entity := range list {
// 			resp.DeletedEntities = append(resp.DeletedEntities, &entities.DeletedEntity{
// 				Id:            entity.DeletedResourcesIRI,
// 				DeleteTime:    &timestamppb.Timestamp{Seconds: entity.DeletedResourcesDeleteTime},
// 				DeletedReason: entity.DeletedResourcesReason,
// 				Metadata:      entity.DeletedResourcesMeta,
// 			})
// 		}
// 		return nil
// 	})

// 	return resp, err
// }

// ListEntityMentions implements listing mentions of an entity in other resources.
func (api *Server) ListEntityMentions(ctx context.Context, in *entities.ListEntityMentionsRequest) (*entities.ListEntityMentionsResponse, error) {
	if in.Id == "" {
		return nil, errutil.MissingArgument("id")
	}

	var cursor mentionsCursor
	if in.PageToken != "" {
		if err := cursor.FromString(in.PageToken); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to decode page token: %v", err)
		}
	}

	// Without this querying in reverse order wouldn't ever return any results.
	if in.ReverseOrder && in.PageToken == "" {
		cursor.BlobID = math.MaxInt64
		cursor.LinkID = math.MaxInt64
	}

	// Arbitrary default page size.
	if in.PageSize == 0 {
		in.PageSize = 10
	}

	resp := &entities.ListEntityMentionsResponse{}

	if err := api.idx.Query(ctx, func(conn *sqlite.Conn) error {
		var eid int64
		if err := sqlitex.Exec(conn, qEntitiesLookupID(), func(stmt *sqlite.Stmt) error {
			eid = stmt.ColumnInt64(0)
			return nil

		}, in.Id); err != nil {
			return err
		}

		if eid == 0 {
			return status.Errorf(codes.NotFound, "entity '%s' is not found", in.Id)
		}

		var lastCursor mentionsCursor

		var count int32

		if err := sqlitex.Exec(conn, qListMentions(in.ReverseOrder), func(stmt *sqlite.Stmt) error {
			// We query for pageSize + 1 items to know if there's more items on the next page,
			// because if not we don't need to return the page token in the response.
			if count == in.PageSize {
				resp.NextPageToken = lastCursor.String()
				return nil
			}

			count++

			var (
				source        = stmt.ColumnText(0)
				sourceBlob    = cid.NewCidV1(uint64(stmt.ColumnInt64(1)), stmt.ColumnBytesUnsafe(2)).String()
				author        = core.Principal(stmt.ColumnBytesUnsafe(3)).String()
				ts            = hlc.Timestamp(stmt.ColumnInt64(4)).Time()
				blobType      = stmt.ColumnText(5)
				isPinned      = stmt.ColumnInt(6) > 0
				anchor        = stmt.ColumnText(7)
				targetVersion = stmt.ColumnText(8)
				fragment      = stmt.ColumnText(9)
			)

			lastCursor.BlobID = stmt.ColumnInt64(10)
			lastCursor.LinkID = stmt.ColumnInt64(11)

			if source == "" && blobType != "Comment" {
				return fmt.Errorf("BUG: missing source for mention of type '%s'", blobType)
			}

			if blobType == "Comment" {
				source = "hm://c/" + sourceBlob
			}

			resp.Mentions = append(resp.Mentions, &entities.Mention{
				Source:        source,
				SourceType:    blobType,
				SourceContext: anchor,
				SourceBlob: &entities.Mention_BlobInfo{
					Cid:        sourceBlob,
					Author:     author,
					CreateTime: timestamppb.New(ts),
				},
				TargetVersion:  targetVersion,
				IsExactVersion: isPinned,
				TargetFragment: fragment,
			})

			return nil
		}, eid, cursor.BlobID, in.PageSize); err != nil {
			return err
		}

		return nil
	}); err != nil {
		return nil, err
	}

	return resp, nil
}

var qEntitiesLookupID = dqb.Str(`
	SELECT resources.id
	FROM resources
	WHERE resources.iri = :entities_eid
	LIMIT 1
`)

const qListMentionsTpl = `
WITH ts_changes AS (
SELECT
    structural_blobs.ts,
    resource_links.id AS link_id,
    resource_links.is_pinned,
    blobs.codec,
    blobs.multihash,
	public_keys.principal AS author,
    resource_links.extra_attrs->>'a' AS anchor,
	resource_links.extra_attrs->>'v' AS target_version,
	resource_links.extra_attrs->>'f' AS target_fragment
FROM resource_links
JOIN structural_blobs ON structural_blobs.id = resource_links.source
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
WHERE resource_links.target = 7
AND structural_blobs.type IN ('Change')
)
SELECT
    resources.iri,
    blobs.codec,
    blobs.multihash,
	public_keys.principal AS author,
    structural_blobs.ts,
    structural_blobs.type AS blob_type,
    resource_links.is_pinned,
    resource_links.extra_attrs->>'a' AS anchor,
	resource_links.extra_attrs->>'v' AS target_version,
	resource_links.extra_attrs->>'f' AS target_fragment,
    blobs.id AS blob_id,
    resource_links.id AS link_id
FROM resource_links
JOIN structural_blobs ON structural_blobs.id = resource_links.source
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
WHERE resource_links.target = :target
AND blobs.id %s :blob_id
AND structural_blobs.type IN ('Comment')

UNION ALL
SELECT
    resources.iri,
    blobs.codec,
    blobs.multihash,
    public_keys.principal AS author,
    structural_blobs.ts,
    'Ref' AS blob_type,
    ts_changes.is_pinned,
    ts_changes.anchor,
	ts_changes.target_version,
	ts_changes.target_fragment,
    blobs.id AS blob_id,
    ts_changes.link_id
FROM structural_blobs
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
JOIN ts_changes on ts_changes.ts = structural_blobs.ts
AND structural_blobs.type IN ('Ref')
AND blobs.id %s :blob_id
ORDER BY blobs.id %s
LIMIT :page_size + 1;
`

func qListMentions(desc bool) string {
	if desc {
		return qListMentionsDesc()
	}

	return qListMentionsAsc()
}

var qListMentionsAsc = dqb.Q(func() string {
	return fmt.Sprintf(qListMentionsTpl, ">", ">", "ASC")
})

var qListMentionsDesc = dqb.Q(func() string {
	return fmt.Sprintf(qListMentionsTpl, "<", "<", "DESC")
})

type mentionsCursor struct {
	BlobID int64 `json:"b"`
	LinkID int64 `json:"l"`
}

func (mc *mentionsCursor) FromString(s string) error {
	data, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, mc)
}

func (mc mentionsCursor) String() string {
	if mc.BlobID == 0 && mc.LinkID == 0 {
		return ""
	}

	data, err := json.Marshal(mc)
	if err != nil {
		panic(err)
	}

	return base64.RawURLEncoding.EncodeToString(data)
}
