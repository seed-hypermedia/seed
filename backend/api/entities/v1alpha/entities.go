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
	"sort"
	"strconv"
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
			state:        entities.DiscoveryTaskState_DISCOVERY_TASK_STARTED,
		}
		api.discoveryTasks[dkey] = task
		go task.start(api)
		api.mu.Unlock()
		return &entities.DiscoverEntityResponse{
			State:     task.state,
			CallCount: int32(task.callCount),
		}, nil
	}
	api.mu.Unlock()

	task.mu.Lock()
	defer task.mu.Unlock()

	task.callCount++
	task.lastCallTime = now

	resp := &entities.DiscoverEntityResponse{
		Version:   task.lastResult.String(),
		State:     task.state,
		CallCount: int32(task.callCount),
	}

	if task.lastErr != nil {
		resp.LastError = task.lastErr.Error()
	}

	if !task.lastResultTime.IsZero() {
		resp.LastResultTime = timestamppb.New(task.lastResultTime)
		resp.ResultExpireTime = timestamppb.New(task.lastResultTime.Add(lastResultTTL))
	}

	return resp, nil
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

	state entities.DiscoveryTaskState
}

func (task *discoveryTask) start(api *Server) {
	for {
		task.mu.Lock()
		task.state = entities.DiscoveryTaskState_DISCOVERY_TASK_IN_PROGRESS
		task.mu.Unlock()

		res, err := api.disc.DiscoverObject(context.Background(), task.key.IRI, task.key.Version, task.key.Recursive)
		now := time.Now()
		task.mu.Lock()
		task.lastResultTime = now
		task.lastResult = res
		task.lastErr = err
		task.state = entities.DiscoveryTaskState_DISCOVERY_TASK_COMPLETED
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
WITH fts_top100 AS (
  SELECT
    fts.raw_content,
    fts.type,
    fts.block_id,
    fts.version,
    fts.blob_id,
    structural_blobs.genesis_blob,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
    fts.rank
  FROM fts
    JOIN structural_blobs
      ON structural_blobs.id = fts.blob_id
    JOIN blobs INDEXED BY blobs_metadata
      ON blobs.id = structural_blobs.id
    JOIN public_keys
      ON public_keys.id = structural_blobs.author
    LEFT JOIN resources
      ON resources.id = structural_blobs.resource
  WHERE fts.raw_content MATCH :ftsStr
    AND fts.type IN (:entityTitle, :entityContact, :entityDoc, :entityComment)
  ORDER BY
  (fts.type = 'contact' || fts.type = 'title') ASC, -- prioritize contacts then titles, comments and documents are mixed based on rank
  fts.rank ASC
)

SELECT
  f.raw_content,
  f.type,
  f.block_id,
  f.version,
  f.blob_id,
  f.tsid,
  resources.iri,
  public_keys.principal AS author,
  pk_subject.principal AS contact_subject,
  blobs.codec,
  blobs.multihash,
  document_generations.metadata,
  dg_subject.metadata AS subject_metadata,
  (
    SELECT json_group_array(
             json_object(
               'codec',    b2.codec,
               'multihash', hex(b2.multihash)
             )
           )
    FROM json_each(document_generations.heads) AS a
      JOIN blobs AS b2
        ON b2.id = a.value
  ) AS heads,
  structural_blobs.ts
FROM fts_top100 AS f
  JOIN structural_blobs
    ON structural_blobs.id = f.blob_id

  JOIN blobs INDEXED BY blobs_metadata
    ON blobs.id = f.blob_id

  JOIN public_keys
    ON public_keys.id = structural_blobs.author

  LEFT JOIN resources
    ON resources.id = (SELECT resource from structural_blobs WHERE
	     (f.blob_id       = structural_blobs.genesis_blob
           AND structural_blobs.type = 'Ref')
      OR (f.genesis_blob = structural_blobs.genesis_blob
           AND structural_blobs.type = 'Ref')
      OR (f.blob_id       = structural_blobs.id
           AND structural_blobs.type = 'Comment')
	  OR (f.blob_id       = structural_blobs.id
           AND structural_blobs.type = 'Contact'
           AND structural_blobs.author = :loggedAccountID)
     limit 1)

  JOIN document_generations
    ON document_generations.resource = resources.id

  LEFT JOIN document_generations dg_subject
	ON dg_subject.resource = (select id from resources where owner in (select extra_attrs->>'subject' from structural_blobs where id = f.blob_id) order by id limit 1)

  LEFT JOIN public_keys pk_subject
    ON pk_subject.id = structural_blobs.extra_attrs->>'subject'

WHERE resources.iri IS NOT NULL AND resources.iri GLOB :iriGlob

ORDER BY
  (f.type = 'contact' || f.type = 'title') ASC, -- prioritize contacts then titles, comments and documents are mixed based on rank
  f.rank ASC
LIMIT :limit
`)

var qGetMetadata = dqb.Str(`
	select dg.metadata, r.iri, pk.principal from document_generations dg
	INNER JOIN resources r ON r.id = dg.resource
	INNER JOIN public_keys pk ON pk.id = r.owner
	WHERE dg.is_deleted = False;`)

var qGetParentsMetadata = dqb.Str(`
	select dg.metadata, r.iri from document_generations dg
	INNER JOIN resources r ON r.id = dg.resource
	WHERE dg.is_deleted = False AND r.iri GLOB :iriGlob;`)
var qGetAccountID = dqb.Str(`
SELECT id FROM public_keys WHERE hex(principal) = :principal LIMIT 1;`)

type searchResult struct {
	content       string
	rawContent    string
	icon          string
	iri           string
	owner         string
	blockID       string
	tsid          string
	docID         string
	blobCID       string
	blobID        int64
	contentType   string
	version       string
	versionTime   *timestamppb.Timestamp
	latestVersion string
}

// SearchEntities implements the Fuzzy search of entities.
func (srv *Server) SearchEntities(ctx context.Context, in *entities.SearchEntitiesRequest) (*entities.SearchEntitiesResponse, error) {
	searchResults := []searchResult{}
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
	re := regexp.MustCompile(`[^A-Za-z0-9_ ]+`)
	cleanQuery := re.ReplaceAllString(in.Query, "")
	if strings.ReplaceAll(cleanQuery, " ", "") == "" {
		return nil, nil
	}

	var bodyMatches []fuzzy.Match
	const entityTypeTitle = "title"
	var entityTypeContact, entityTypeDoc, entityTypeComment interface{}

	if in.IncludeBody {
		entityTypeDoc = "document"
		entityTypeComment = "comment"
	}
	var loggedAccountID int64 = 0
	if in.LoggedAccountUid != "" {
		ppal, err := core.DecodePrincipal(in.LoggedAccountUid)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "bad provided logged account UID %s: %v", in.LoggedAccountUid, err)
		}
		ppalHex := hex.EncodeToString(ppal)
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, qGetAccountID(), func(stmt *sqlite.Stmt) error {
				loggedAccountID = stmt.ColumnInt64(0)
				return nil
			}, strings.ToUpper(ppalHex))
		}); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "Problem getting logged account ID %s: %v", in.LoggedAccountUid, err)
		}
		entityTypeContact = "contact"
	}
	resultsLmit := 2000

	if len(cleanQuery) < 3 {
		resultsLmit = 200
	}
	ftsStr := strings.ReplaceAll(cleanQuery, " ", "+")
	if ftsStr[len(ftsStr)-1] == '+' {
		ftsStr = ftsStr[:len(ftsStr)-1]
	}
	ftsStr += "*"
	if in.ContextSize < 2 {
		in.ContextSize = 48
	}
	//fmt.Println("context size:", in.ContextSize)
	var iriGlob string = "hm://" + in.AccountUid + "*"
	contextBefore := int(math.Ceil(float64(in.ContextSize) / 2.0))
	contextAfter := int(in.ContextSize) - contextBefore
	var numResults int = 0
	//before := time.Now()
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qGetFTS(), func(stmt *sqlite.Stmt) error {
			var res searchResult
			var icon icon
			var heads []head
			res.rawContent = stmt.ColumnText(0)
			firstRuneOffset, _, matchedRunes, _ := indexOfQueryPattern(res.rawContent, cleanQuery)
			if firstRuneOffset == -1 {
				return nil
			}
			// before extracting matchStr, convert fullMatchStr to runes
			fullRunes := []rune(res.rawContent)
			nRunes := len(fullRunes)

			var contextStart, contextEndRune int
			// default to full slice
			contextEndRune = nRunes

			if firstRuneOffset > contextBefore {
				contextStart = firstRuneOffset - contextBefore
			}
			if firstRuneOffset+matchedRunes < nRunes-contextAfter {
				contextEndRune = firstRuneOffset + matchedRunes + contextAfter
			}

			// build substring on rune boundaries
			res.content = string(fullRunes[contextStart:contextEndRune])

			res.blobCID = cid.NewCidV1(uint64(stmt.ColumnInt64(9)), stmt.ColumnBytesUnsafe(10)).String()

			res.contentType = stmt.ColumnText(1)
			res.blockID = stmt.ColumnText(2)
			res.version = stmt.ColumnText(3)
			res.blobID = stmt.ColumnInt64(4)
			res.tsid = stmt.ColumnText(5)
			res.docID = stmt.ColumnText(6)
			res.owner = core.Principal(stmt.ColumnBytes(7)).String()
			subjectID := core.Principal(stmt.ColumnBytes(8)).String()
			if err := json.Unmarshal(stmt.ColumnBytes(11), &icon); err != nil {
				icon.Icon.Value = ""
			}
			if err := json.Unmarshal(stmt.ColumnBytes(13), &heads); err != nil {
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
			res.latestVersion = docmodel.NewVersion(cids...).String()

			ts := hlc.Timestamp(stmt.ColumnInt64(14) * 1000).Time()
			res.versionTime = timestamppb.New(ts)
			if res.contentType == "comment" {
				res.iri = "hm://" + res.owner + "/" + res.tsid
			} else if res.contentType == "contact" {
				res.iri = "hm://" + subjectID + "/" + res.tsid
				if err := json.Unmarshal(stmt.ColumnBytes(12), &icon); err != nil {
					icon.Icon.Value = ""
				}
			} else {
				res.iri = res.docID
			}
			res.icon = icon.Icon.Value
			offsets := []int{firstRuneOffset}
			for i := firstRuneOffset + 1; i < firstRuneOffset+matchedRunes; i++ {
				offsets = append(offsets, i)
			}
			bodyMatches = append(bodyMatches, fuzzy.Match{
				Str:            res.content,
				Index:          numResults,
				Score:          1,
				MatchedIndexes: offsets,
			})
			searchResults = append(searchResults, res)
			numResults++
			return nil
		}, ftsStr, entityTypeTitle, entityTypeContact, entityTypeDoc, entityTypeComment, loggedAccountID, iriGlob, resultsLmit)
	}); err != nil {
		return nil, err
	}

	seen := make(map[string]int)
	var uniqueResults []searchResult
	var uniqueBodyMatches []fuzzy.Match
	for i, res := range searchResults {
		key := fmt.Sprintf("%s|%s|%s|%s", res.iri, res.blockID, res.rawContent, res.contentType)
		if idx, ok := seen[key]; ok {
			// duplicate – compare blobID
			if res.blobID > uniqueResults[idx].blobID {
				uniqueResults[idx] = res
				bm := bodyMatches[i]
				bm.Index = idx
				uniqueBodyMatches[idx] = bm
			}
		} else {
			// first time seeing this key
			seen[key] = len(uniqueResults)
			uniqueResults = append(uniqueResults, res)
			bm := bodyMatches[i]
			bm.Index = len(uniqueResults) - 1
			uniqueBodyMatches = append(uniqueBodyMatches, bm)
		}
	}
	//fmt.Println("unique results:", len(uniqueResults), "out of", len(searchResults))
	bodyMatches = uniqueBodyMatches
	searchResults = uniqueResults

	//after := time.Now()
	//elapsed := after.Sub(before)
	//fmt.Printf("qGetFTS took %.9f s and returned %d results\n", elapsed.Seconds(), len(bodyMatches))
	matchingEntities := []*entities.Entity{}
	getParentsFcn := func(match fuzzy.Match) ([]string, error) {
		parents := make(map[string]interface{})
		breadcrum := strings.Split(strings.TrimPrefix(searchResults[match.Index].iri, "hm://"), "/")
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
	//before = time.Now()
	//totalGetParentsTime := time.Duration(0)
	//totalLatestBlockTime := time.Duration(0)
	//var timesCalled int

	for _, match := range bodyMatches {
		//startParents := time.Now()
		var parentTitles []string
		var err error
		if searchResults[match.Index].contentType != "contact" {
			if parentTitles, err = getParentsFcn(match); err != nil {
				return nil, err
			}
		}
		//totalGetParentsTime += time.Since(startParents)

		offsets := make([]int64, len(match.MatchedIndexes))
		for j, off := range match.MatchedIndexes {
			offsets[j] = int64(off)
		}
		id := searchResults[match.Index].iri

		if searchResults[match.Index].version != "" && searchResults[match.Index].contentType != "comment" {
			if searchResults[match.Index].latestVersion == searchResults[match.Index].version {
				searchResults[match.Index].version += "&l"
			}

			if searchResults[match.Index].version != "" {
				id += "?v=" + searchResults[match.Index].version
			}

			if searchResults[match.Index].blockID != "" {
				id += "#" + searchResults[match.Index].blockID
				if len(offsets) > 1 {
					id += "[" + strconv.FormatInt(offsets[0], 10) + ":" + strconv.FormatInt(offsets[len(offsets)-1]+1, 10) + "]"
				}
			}
		}

		matchingEntities = append(matchingEntities, &entities.Entity{
			DocId:       searchResults[match.Index].docID,
			Id:          id,
			BlobId:      searchResults[match.Index].blobCID,
			Type:        searchResults[match.Index].contentType,
			VersionTime: searchResults[match.Index].versionTime,
			Content:     match.Str,
			ParentNames: parentTitles,
			Icon:        searchResults[match.Index].icon,
			Owner:       searchResults[match.Index].owner})
	}
	//after = time.Now()

	//fmt.Printf("getParentsFcn took %.9f s\n", after.Sub(before).Seconds())
	//fmt.Printf("getParentsFcn took %.9f s\n", totalGetParentsTime.Seconds())
	//fmt.Printf("qGetLatestBlockChange took %.9f s and was called %d times\n", totalLatestBlockTime.Seconds(), timesCalled)

	sort.Slice(matchingEntities, func(i, j int) bool {
		a, b := matchingEntities[i], matchingEntities[j]

		// 1) contacts first
		isContactA := a.Type == "contact"
		isContactB := b.Type == "contact"
		if isContactA != isContactB {
			return isContactA
		}

		// 2) then titles
		isTitleA := a.Type == "title"
		isTitleB := b.Type == "title"
		if isTitleA != isTitleB {
			return isTitleA
		}

		// 3) then by DocId (lexicographically)
		if a.DocId != b.DocId {
			return a.DocId < b.DocId
		}

		// 4) finally by VersionTime descending
		return a.VersionTime.AsTime().After(b.VersionTime.AsTime())
	})

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
				tsid          = stmt.ColumnText(12)
			)

			lastCursor.BlobID = stmt.ColumnInt64(10)
			lastCursor.LinkID = stmt.ColumnInt64(11)

			if source == "" && blobType != "Comment" {
				return fmt.Errorf("BUG: missing source for mention of type '%s'", blobType)
			}

			if blobType == "Comment" {
				sourceDoc = source
				source = "hm://" + author + "/" + tsid

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
WITH changes AS (
SELECT
    structural_blobs.genesis_blob,
    resource_links.id AS link_id,
    resource_links.is_pinned,
    blobs.codec,
    blobs.multihash,
	blobs.id,
	public_keys.principal AS author,
    resource_links.extra_attrs->>'a' AS anchor,
	resource_links.extra_attrs->>'v' AS target_version,
	resource_links.extra_attrs->>'f' AS target_fragment,
	structural_blobs.extra_attrs->>'tsid' AS tsid
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
    resource_links.id AS link_id,
	structural_blobs.extra_attrs->>'tsid' AS tsid
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
    changes.is_pinned,
    changes.anchor,
	changes.target_version,
	changes.target_fragment,
    blobs.id AS blob_id,
    changes.link_id,
	structural_blobs.extra_attrs->>'tsid' AS tsid
FROM structural_blobs
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
JOIN changes ON ((changes.genesis_blob = structural_blobs.genesis_blob OR changes.id = structural_blobs.genesis_blob) AND structural_blobs.type = 'Ref') OR (changes.id = structural_blobs.id AND structural_blobs.type = 'Comment')
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
