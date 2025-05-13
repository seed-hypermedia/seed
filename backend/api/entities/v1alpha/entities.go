// Package entities implements the Entities API.
package entities

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core"
	entities "seed/backend/genproto/entities/v1alpha"
	"seed/backend/hlc"
	"seed/backend/util/dqb"
	"seed/backend/util/errutil"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

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

	db   *sqlitex.Pool
	disc Discoverer

	mu             sync.Mutex
	discoveryTasks map[discoveryTaskKey]*discoveryTask
}

// NewServer creates a new entities server.
func NewServer(db *sqlitex.Pool, disc Discoverer) *Server {
	return &Server{
		db:             db,
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

var qGetFTS = dqb.Str(`
WITH fts_data AS (
SELECT
    fts.raw_content,
    fts.type,
    fts.block_id,
	fts.version,
	fts.blob_id,
    resources.iri,
    structural_blobs.genesis_blob,
    fts.rank
    
FROM fts
JOIN structural_blobs ON structural_blobs.id = fts.blob_id
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
WHERE fts.raw_content MATCH :ftsStr AND
fts.type IN ('document', 'comment') ORDER BY rank
)

SELECT
    fts_data.raw_content,
    fts_data.type,
	fts_data.block_id,
	fts_data.version,
	fts_data.blob_id,
    resources.iri,
    public_keys.principal AS author,
    blobs.codec,
    blobs.multihash,
    document_generations.metadata,
	(
    SELECT
      json_group_array(
        json_object(
          'codec',    b2.codec,
          'multihash', hex(b2.multihash)
        )
      )
    FROM json_each(document_generations.heads) AS a
      JOIN blobs AS b2
        ON b2.id = a.value
  	) AS heads
    
FROM fts_data
JOIN structural_blobs ON (fts_data.genesis_blob = structural_blobs.genesis_blob OR fts_data.blob_id = structural_blobs.genesis_blob) AND structural_blobs.type = 'Ref'
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
JOIN document_generations ON document_generations.resource = resources.id
LEFT JOIN resources ON resources.id = structural_blobs.resource
WHERE resources.iri IS NOT NULL
GROUP BY fts_data.raw_content, 
fts_data.type, 
fts_data.block_id, 
fts_data.version, 
fts_data.blob_id, 
resources.iri, 
author 
ORDER BY fts_data.rank;`)

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
	var contents []string
	var rawContent []string
	var icons []string
	var iris []string
	var owners []string
	var blockIDs []string
	var docIDs []string
	var blobCIDs []string
	var blobIDs []int64
	var contentType []string
	var versions []string
	var latestVersions []string
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

	type head struct {
		Multihash string `json:"multihash"`
		Codec     uint64 `json:"codec"`
	}
	re := regexp.MustCompile(`[^A-Za-z0-9_* ]+`)
	cleanQuery := re.ReplaceAllString(in.Query, "")
	if strings.Replace(cleanQuery, " ", "", -1) == "" {
		return nil, nil
	}
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qGetMetadata(), func(stmt *sqlite.Stmt) error {
			var title title
			var icon icon
			if err := json.Unmarshal(stmt.ColumnBytes(0), &title); err != nil {
				return nil
			}
			contents = append(contents, title.Name.Value)
			if err := json.Unmarshal(stmt.ColumnBytes(0), &icon); err != nil {
				return nil
			}
			icons = append(icons, icon.Icon.Value)
			iri := stmt.ColumnText(1)
			iris = append(iris, iri)
			docIDs = append(docIDs, iri)
			ownerID := core.Principal(stmt.ColumnBytes(2)).String()
			owners = append(owners, ownerID)
			rawContent = append(rawContent, title.Name.Value)
			blockIDs = append(blockIDs, "")
			blobCIDs = append(blobCIDs, "")
			versions = append(versions, "")
			latestVersions = append(latestVersions, "")
			blobIDs = append(blobIDs, 0)
			contentType = append(contentType, "title")
			return nil
		})
	}); err != nil {
		return nil, err
	}
	var numTitles = len(contents)
	var bodyMatches []fuzzy.Match
	if in.IncludeBody {
		ftsStr := strings.ReplaceAll(cleanQuery, " ", "+")
		if !strings.HasSuffix(ftsStr, "*") {
			ftsStr += "*"
		}
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, qGetFTS(), func(stmt *sqlite.Stmt) error {
				var icon icon
				var heads []head
				fullMatchStr := stmt.ColumnText(0)
				rawContent = append(rawContent, fullMatchStr)
				firstRuneOffset, firstCharOffset, matchedRunes, matchedChars := indexOfQueryPattern(fullMatchStr, cleanQuery)
				if firstRuneOffset == -1 {
					return nil
				}
				var contextStart int
				var contextEnd = len(fullMatchStr)
				if firstCharOffset > 16 {
					contextStart = firstCharOffset - 16
				}
				if firstCharOffset+matchedChars < len(fullMatchStr)-24 {
					contextEnd = firstCharOffset + matchedChars + 24
				}
				matchStr := fullMatchStr[contextStart:min(contextEnd, len(fullMatchStr))]
				contents = append(contents, matchStr)
				if err := json.Unmarshal(stmt.ColumnBytes(9), &icon); err != nil {
					return nil
				}
				icons = append(icons, icon.Icon.Value)
				blobCID := cid.NewCidV1(uint64(stmt.ColumnInt64(7)), stmt.ColumnBytesUnsafe(8)).String()
				blobCIDs = append(blobCIDs, blobCID)
				blobIDs = append(blobIDs, stmt.ColumnInt64(4))
				cType := stmt.ColumnText(1)
				iri := stmt.ColumnText(5)
				docIDs = append(docIDs, iri)
				if err := json.Unmarshal(stmt.ColumnBytes(10), &heads); err != nil {
					return err
				}

				cids := make([]cid.Cid, len(heads))
				for i, h := range heads {
					mhBinary, err := hex.DecodeString(h.Multihash)
					if err != nil {
						return err
					}
					cids[i] = cid.NewCidV1(h.Codec, mhBinary)
				}
				latestVersion := docmodel.NewVersion(cids...).String()
				version := stmt.ColumnText(3)
				latestVersions = append(latestVersions, latestVersion)
				versions = append(versions, version)

				if cType == "comment" {
					iris = append(iris, "hm://c/"+blobCID)
				} else {
					iris = append(iris, iri)
				}
				contentType = append(contentType, cType)
				blockIDs = append(blockIDs, stmt.ColumnText(2))
				ownerID := core.Principal(stmt.ColumnBytes(6)).String()
				owners = append(owners, ownerID)
				offsets := []int{firstRuneOffset}
				for i := firstRuneOffset + 1; i < firstRuneOffset+matchedRunes; i++ {
					offsets = append(offsets, i)
				}
				bodyMatches = append(bodyMatches, fuzzy.Match{
					Str:            matchStr,
					Index:          len(contents) - 1,
					Score:          1,
					MatchedIndexes: offsets,
				})
				return nil
			}, ftsStr)
		}); err != nil {
			return nil, err
		}
	}
	titleMatches := fuzzy.Find(cleanQuery, contents[:numTitles])
	matchingEntities := []*entities.Entity{}
	getParentsFcn := func(match fuzzy.Match) ([]string, error) {
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
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
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
				return nil
			}, root)
		}); err != nil {
			return nil, err
		}
		return parentTitles, nil
	}

	for i, match := range titleMatches {
		if match.Score < 0 {
			limit++
			continue
		}
		if i >= limit {
			break
		}

		parentTitles, err := getParentsFcn(match)
		if err != nil {
			return nil, err
		}

		offsets := make([]int64, len(match.MatchedIndexes))
		for j, off := range match.MatchedIndexes {
			offsets[j] = int64(off)
		}
		matchingEntities = append(matchingEntities, &entities.Entity{
			Id:          iris[match.Index],
			BlockId:     blockIDs[match.Index],
			BlobId:      blobCIDs[match.Index],
			Version:     versions[match.Index],
			Content:     match.Str,
			Type:        contentType[match.Index],
			ParentNames: parentTitles,
			Icon:        icons[match.Index],
			MatchOffset: offsets,
			Owner:       owners[match.Index]})
	}
	for _, match := range bodyMatches {
		parentTitles, err := getParentsFcn(match)
		if err != nil {
			return nil, err
		}

		offsets := make([]int64, len(match.MatchedIndexes))
		for j, off := range match.MatchedIndexes {
			offsets[j] = int64(off)
		}
		id := iris[match.Index]
		if versions[match.Index] != "" {
			var version string
			id += "?v=" + versions[match.Index]

			if blockIDs[match.Index] != "" {
				id += "#" + blockIDs[match.Index]
			}

			if latestVersions[match.Index] == versions[match.Index] {
				versions[match.Index] = ""
			} else {
				if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
					return sqlitex.Exec(conn, qGetLatestBlockChange(), func(stmt *sqlite.Stmt) error {
						version = stmt.ColumnText(0)
						return nil
					}, blobIDs[match.Index], blockIDs[match.Index], rawContent[match.Index])
				}); err != nil {
					return nil, err
				}
				versions[match.Index] = version
			}
		}
		matchingEntities = append(matchingEntities, &entities.Entity{
			Id:          id,
			BlockId:     blockIDs[match.Index],
			BlobId:      blobCIDs[match.Index],
			Version:     versions[match.Index],
			Type:        contentType[match.Index],
			Content:     match.Str,
			ParentNames: parentTitles,
			Icon:        icons[match.Index],
			MatchOffset: offsets,
			Owner:       owners[match.Index]})
	}
	return &entities.SearchEntitiesResponse{Entities: matchingEntities}, nil
}

var qGetLatestBlockChange = dqb.Str(`
WITH doc_changes AS (
SELECT 
blob_id,
block_id,
raw_content,
version
FROM fts
WHERE blob_id in (
SELECT
id
FROM structural_blobs
WHERE structural_blobs.ts IN (SELECT ts from structural_blobs WHERE resource in (
WITH resource_data AS (
SELECT
    structural_blobs.resource,
    structural_blobs.ts
    
FROM structural_blobs
WHERE id = :blob_id
)
SELECT
structural_blobs.resource
FROM structural_blobs 
JOIN resource_data ON resource_data.ts=structural_blobs.ts
WHERE structural_blobs.resource IS NOT NULL
LIMIT 1
)) AND structural_blobs.type = 'Change')
), latest_changes AS(
SELECT 
version,
blob_id
FROM doc_changes 
WHERE blob_id > :blob_id AND (block_id = :block_id OR raw_content = :raw_content)
ORDER BY blob_id ASC LIMIT 1
)
SELECT version, blob_id 
FROM doc_changes
WHERE blob_id BETWEEN :blob_id and (select blob_id from latest_changes)-1
ORDER BY blob_id DESC LIMIT 1;
`)

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

	if err := api.db.WithSave(ctx, func(conn *sqlite.Conn) error {
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
				sourceDoc     string
				source        = stmt.ColumnText(0)
				sourceBlob    = cid.NewCidV1(uint64(stmt.ColumnInt64(1)), stmt.ColumnBytesUnsafe(2)).String()
				author        = core.Principal(stmt.ColumnBytesUnsafe(3)).String()
				ts            = hlc.Timestamp(stmt.ColumnInt64(4) * 1000).Time()
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
				sourceDoc = source
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
				SourceDocument: sourceDoc,
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
WHERE resource_links.target = :target
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

func patternToRegex(pattern string) string {
	// If the user specifies ^ or $ at the beginning or end, we keep them.
	startAnchor := strings.HasPrefix(pattern, "^")
	endAnchor := strings.HasSuffix(pattern, "$")
	// Remove anchors temporarily.
	p := pattern
	if startAnchor {
		p = strings.TrimPrefix(p, "^")
	}
	if endAnchor {
		p = strings.TrimSuffix(p, "$")
	}
	// Escape meta characters.
	quoted := regexp.QuoteMeta(p)
	// Replace escaped wildcard with a pattern matching non-whitespace characters.
	quoted = strings.ReplaceAll(quoted, "\\*", "[^\\s]*")
	if startAnchor {
		quoted = "^" + quoted
	}
	if endAnchor {
		quoted = quoted + "$"
	}
	// Make search case-insensitive.
	return "(?i)" + quoted
}

func indexOfQueryPattern(haystack, pattern string) (startRunes, startChars, matchedRunes, matchedChars int) {
	// Convert the pattern to a regex pattern.
	regexPattern := patternToRegex(pattern)
	re := regexp.MustCompile(regexPattern)
	loc := re.FindStringIndex(haystack)
	if loc == nil {
		return -1, -1, 0, 0
	}
	// The start index in runes.
	startRunes = utf8.RuneCountInString(haystack[:loc[0]])
	// The start index in characters (bytes).
	startChars = loc[0]
	// The matched length in runes.
	matchedRunes = utf8.RuneCountInString(haystack[loc[0]:loc[1]])
	// The matched length in characters (bytes).
	matchedChars = loc[1] - loc[0]
	return
}
