// Package activity manages the activity feed.
package activity

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"seed/backend/api/documents/v3alpha/docmodel"
	entities "seed/backend/api/entities/v1alpha"
	"seed/backend/blob"
	"seed/backend/core"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/storage"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"seed/backend/util/apiutil"
	"seed/backend/util/cleanup"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type syncer interface {
	DiscoverObject(ctx context.Context, entityID blob.IRI, version blob.Version, recursive bool) (blob.Version, error)
}

// Server implements the Activity gRPC API.
type Server struct {
	db        *sqlitex.Pool
	startTime time.Time
	clean     *cleanup.Stack
	log       *zap.Logger
	syncer    syncer
}

type head struct {
	Multihash string `json:"multihash"`
	Codec     uint64 `json:"codec"`
}

var resourcePattern = regexp.MustCompile(`^hm://[a-zA-Z0-9*]+/?[a-zA-Z0-9*-/]*$`)

// NewServer creates a new Server.
func NewServer(db *sqlitex.Pool, log *zap.Logger, clean *cleanup.Stack) *Server {
	return &Server{
		db:        db,
		startTime: time.Now(),
		clean:     clean,
		log:       log,
	}
}

// SetSyncer includes the syncer into the server in case it
// was not available during initialization.
func (srv *Server) SetSyncer(sync syncer) {
	srv.syncer = sync
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	activity.RegisterActivityFeedServer(rpc, srv)
	activity.RegisterSubscriptionsServer(rpc, srv)
}

// ListEvents list all the events seen locally.
func (srv *Server) ListEvents(ctx context.Context, req *activity.ListEventsRequest) (*activity.ListEventsResponse, error) {
	var cursorBlobID int64 = math.MaxInt64
	if req.PageToken != "" {
		if err := apiutil.DecodePageToken(req.PageToken, &cursorBlobID, nil); err != nil {
			return nil, fmt.Errorf("failed to decode page token: %w", err)
		}
	}
	var events []*activity.Event
	// Track the structural timestamp (ms) used for DB paging, aligned with events slice.
	var cursorTS []int64
	srv.log.Debug("Listing events", zap.Int64("cursor_blob_id", cursorBlobID))
	var filtersStr string
	var authorsJSON, linkTypesJSON string

	filterResource := "*"
	if len(req.FilterResource) > 0 {
		if !resourcePattern.MatchString(req.FilterResource) {
			return nil, fmt.Errorf("Invalid resource format [%s]", req.FilterResource)
		}
		filterResource = req.FilterResource
	}
	var initialMovedResources map[string]string = make(map[string]string)
	err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qGetMovedBlocksByResourceID(), func(stmt *sqlite.Stmt) error {
			isDeleted := stmt.ColumnInt(2) == 1
			if !isDeleted {
				initialMovedResources[stmt.ColumnText(0)] = stmt.ColumnText(1)
			}
			return nil
		}, filterResource)
	})
	if err != nil {
		return nil, err
	}
	var initialIris []string
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, qEntitiesLookupID(), func(stmt *sqlite.Stmt) error {
			if stmt.ColumnInt64(0) == 0 {
				return nil
			}
			initialIris = append(initialIris, stmt.ColumnText(1))
			return nil

		}, filterResource); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}
	var initialEidsUpdated []string
	for _, iri := range initialIris {
		oldIri, ok := initialMovedResources[iri]
		initialEidsUpdated = append(initialEidsUpdated, iri)
		if ok {
			initialEidsUpdated = append(initialEidsUpdated, oldIri)
		}
	}
	if len(req.FilterAuthors) > 0 {
		filtersStr = storage.PublicKeysPrincipal.String() + " in ("
		authorsJSON = "["
		for i, user := range req.FilterAuthors {
			if i > 0 {
				filtersStr += ", "
			}
			principal, err := core.DecodePrincipal(user)
			if err != nil {
				return nil, fmt.Errorf("Invalid user filter [%s]: %w", user, err)
			}
			principalHex := strings.ToUpper(hex.EncodeToString(principal))
			authorsJSON += "\"" + principalHex + "\", "
			filtersStr += "unhex('" + principalHex + "')"
		}
		if len(authorsJSON) > 1 {
			authorsJSON = strings.TrimSuffix(authorsJSON, ", ")
		}
		authorsJSON += "]"
		filtersStr += ") AND "
	}

	if len(req.FilterEventType) > 0 {
		filtersStr += "lower(" + storage.StructuralBlobsType.String() + ") in ("
		linkTypesJSON = "["
		for i, eventType := range req.FilterEventType {
			// Hardcode this to prevent injection attacks
			if strings.ToLower(eventType) != "capability" &&
				strings.ToLower(eventType) != "ref" &&
				strings.ToLower(eventType) != "comment" &&
				strings.ToLower(eventType) != "dagpb" &&
				strings.ToLower(eventType) != "profile" &&
				strings.ToLower(eventType) != "contact" &&
				strings.ToLower(eventType) != "comment/target" &&
				strings.ToLower(eventType) != "comment/embed" &&
				strings.ToLower(eventType) != "doc/embed" &&
				strings.ToLower(eventType) != "doc/link" &&
				strings.ToLower(eventType) != "doc/button" {
				return nil, fmt.Errorf("Invalid event type filter [%s]: Only Capability | Ref | Comment | DagPB | Profile | Contact | Comment/Target | Comment/Embed | Doc/Embed | Doc/Link | Doc/Button are supported at the moment", eventType)
			}
			if i > 0 {
				filtersStr += ", "
			}
			filtersStr += "'" + strings.ToLower(eventType) + "'"
			linkTypesJSON += "\"" + strings.ToLower(eventType) + "\", "
		}
		if len(linkTypesJSON) > 1 {
			linkTypesJSON = strings.TrimSuffix(linkTypesJSON, ", ")
		}
		linkTypesJSON += "]"
		filtersStr += ") AND "
	}
	if len(initialEidsUpdated) == 0 {
		return &activity.ListEventsResponse{}, nil
	}
	filtersStr += storage.ResourcesIRI.String() + " IN ('" + strings.Join(initialEidsUpdated, "', '") + "')"
	filtersStr += " AND "
	var (
		selectStr            = "SELECT distinct " + storage.BlobsID + ", " + storage.StructuralBlobsType + ", " + storage.PublicKeysPrincipal + ", " + storage.ResourcesIRI + ", " + storage.StructuralBlobsTs + ", " + storage.BlobsInsertTime + ", " + storage.BlobsMultihash + ", " + storage.BlobsCodec + ", " + "structural_blobs.extra_attrs->>'tsid' AS tsid" + ", " + "structural_blobs.extra_attrs" + ", " + storage.StructuralBlobsGenesisBlob
		tableStr             = "FROM " + storage.T_StructuralBlobs
		joinIDStr            = "JOIN " + storage.Blobs.String() + " ON " + storage.BlobsID.String() + "=" + storage.StructuralBlobsID.String()
		joinpkStr            = "JOIN " + storage.PublicKeys.String() + " ON " + storage.StructuralBlobsAuthor.String() + "=" + storage.PublicKeysID.String()
		joinLinksStr         = "LEFT JOIN " + storage.ResourceLinks.String() + " ON " + storage.StructuralBlobsID.String() + "=" + storage.ResourceLinksSource.String()
		leftjoinResourcesStr = "LEFT JOIN " + storage.Resources.String() + " ON " + storage.StructuralBlobsResource.String() + "=" + storage.ResourcesID.String()

		pageTokenStr = storage.StructuralBlobsTs.String() + " <= :idx AND " + storage.StructuralBlobsType.String() + " != 'Change' AND " + storage.BlobsSize.String() + ">0 ORDER BY " + storage.StructuralBlobsTs.String() + " desc limit :page_size"
	)
	if req.PageSize <= 0 {
		req.PageSize = 30
	}
	var getEventsStr = fmt.Sprintf(`
		%s
		%s
		%s
		%s
		%s
		%s
		WHERE %s %s;
	`, selectStr, tableStr, joinIDStr, joinpkStr, joinLinksStr, leftjoinResourcesStr, filtersStr, pageTokenStr)
	var refIDs, resources, genesisBlobIDs []string
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		err := sqlitex.Exec(conn, dqb.Str(getEventsStr)(), func(stmt *sqlite.Stmt) error {
			id := stmt.ColumnInt64(0)
			eventType := stmt.ColumnText(1)
			author := stmt.ColumnBytes(2)
			resource := stmt.ColumnText(3)
			// Structural timestamp (ms) used for DB paging
			structTsMillis := stmt.ColumnInt64(4)
			eventTime := timestamppb.New(time.UnixMilli(structTsMillis))
			observeTime := timestamppb.New(time.Unix(stmt.ColumnInt64(5), 0))
			mhash := stmt.ColumnBytes(6)
			codec := stmt.ColumnInt64(7)
			tsid := blob.TSID(stmt.ColumnText(8))
			extraAttrs := stmt.ColumnText(9)
			accountID := core.Principal(author).String()
			cID := cid.NewCidV1(uint64(codec), mhash)
			if eventType == "Ref" {
				refIDs = append(refIDs, strconv.FormatInt(id, 10))
				resources = append(resources, resource)
			}
			if eventType == "Comment" {
				resource = "hm://" + accountID + "/" + tsid.String()
				eventTime = timestamppb.New(tsid.Timestamp())
			}
			event := activity.Event{
				Data: &activity.Event_NewBlob{NewBlob: &activity.NewBlobEvent{
					Cid:        cID.String(),
					BlobType:   eventType,
					Author:     accountID,
					Resource:   resource,
					ExtraAttrs: extraAttrs,
					BlobId:     id,
				}},
				Account:     accountID,
				EventTime:   eventTime,
				ObserveTime: observeTime,
			}
			events = append(events, &event)
			cursorTS = append(cursorTS, structTsMillis)
			genesisBlobIDs = append(genesisBlobIDs, strconv.FormatInt(stmt.ColumnInt64(10), 10))
			return nil
		}, cursorBlobID, req.PageSize)
		if err != nil {
			return fmt.Errorf("Problem collecting activity feed, Probably token out of range or no feed at all: %w", err)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	refsJson := "[" + strings.Join(refIDs, ",") + "]"
	var versions = map[int64]string{}
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {

		if err := sqlitex.Exec(conn, qGetChangesFromRefs(), func(stmt *sqlite.Stmt) error {

			mhBinary, err := hex.DecodeString(stmt.ColumnText(0))
			if err != nil {
				return err
			}
			cid := cid.NewCidV1(uint64(stmt.ColumnInt64(1)), mhBinary)
			version := docmodel.NewVersion(cid).String()
			seenRefID := stmt.ColumnInt64(2)
			versions[seenRefID] = version
			return nil

		}, refsJson); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}

	var heads []head
	var latestVersions = map[string]string{}
	resourcesJson := "[\"" + strings.Join(resources, "\",\"") + "\"]"
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, qGetLatestVersions(), func(stmt *sqlite.Stmt) error {
			resource := stmt.ColumnText(0)
			if err := json.Unmarshal(stmt.ColumnBytes(1), &heads); err != nil {
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
			latestVersions[resource] = latestVersion
			return nil

		}, resourcesJson); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return nil, err
	}
	for _, e := range events {
		if e.Data.(*activity.Event_NewBlob).NewBlob.BlobType == "Ref" {
			version, ok := versions[e.Data.(*activity.Event_NewBlob).NewBlob.BlobId]
			if !ok {
				srv.log.Warn("Missing version for Ref blob", zap.Int64("blob_id", e.Data.(*activity.Event_NewBlob).NewBlob.BlobId))
				continue
			}

			if latest, ok := latestVersions[e.Data.(*activity.Event_NewBlob).NewBlob.Resource]; ok {
				if latest == version {
					version += "&l"
				}
			}
			e.Data.(*activity.Event_NewBlob).NewBlob.Resource += "?v=" + version
		}
	}

	var deletedList []string

	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		var eids []string
		irisJSON := "['" + strings.Join(initialEidsUpdated, "', '") + "']"
		if err := sqlitex.Exec(conn, qGetIdsFromIris(), func(stmt *sqlite.Stmt) error {
			eid := stmt.ColumnInt64(0)
			if eid == 0 {
				return nil
			}
			eids = append(eids, strconv.FormatInt(eid, 10))
			return nil

		}, irisJSON); err != nil {
			return err
		}

		if len(eids) > 0 {
			eidsJSON := "[" + strings.Join(eids, ",") + "]"
			args := []interface{}{eidsJSON, cursorBlobID}
			queryStr := listMentionsCore
			if len(authorsJSON) > 2 {
				queryStr += authorsFilterMentions
				args = append(args, authorsJSON)
			}
			if len(linkTypesJSON) > 2 {
				queryStr += linkTypesFilterMentions
				args = append(args, linkTypesJSON)
			}
			queryStr += pagingMentions
			if len(authorsJSON) > 2 {
				queryStr += authorsFilterMentions
			}
			if len(linkTypesJSON) > 2 {
				queryStr += linkTypesFilterMentions
			}
			queryStr += limitMentions
			args = append(args, req.PageSize)
			if err := sqlitex.Exec(conn, dqb.Str(queryStr)(), func(stmt *sqlite.Stmt) error {
				var (
					source     = stmt.ColumnText(0)
					sourceBlob = cid.NewCidV1(uint64(stmt.ColumnInt64(1)), stmt.ColumnBytesUnsafe(2)).String()
					author     = core.Principal(stmt.ColumnBytesUnsafe(3)).String()
					// Structural timestamp (ms) used for DB paging
					structTsMillis = stmt.ColumnInt64(4)
					eventTime      = timestamppb.New(time.UnixMilli(structTsMillis))
					blobType       = stmt.ColumnText(5)

					isPinned = stmt.ColumnInt(6) > 0
					//anchor        = stmt.ColumnText(7)
					targetVersion = stmt.ColumnText(8)
					fragment      = stmt.ColumnText(9)

					linkType    = stmt.ColumnText(10)
					blobID      = stmt.ColumnInt64(11)
					observeTime = timestamppb.New(time.Unix(stmt.ColumnInt64(12), 0))
					tsid        = blob.TSID(stmt.ColumnText(13))
					extraAttrs  = stmt.ColumnText(14)
					isDeleted   = stmt.ColumnText(16) == "1"
				)
				genesisBlobIDs = append(genesisBlobIDs, strconv.FormatInt(stmt.ColumnInt64(17), 10))
				if source == "" && blobType != "Comment" {
					return fmt.Errorf("BUG: missing source for link of type '%s'", blobType)
				}

				if blobType == "Comment" {
					source = "hm://" + author + "/" + tsid.String()
					eventTime = timestamppb.New(tsid.Timestamp())

				} else {
					if targetVersion != "" {
						source = strings.TrimSuffix(source, "/") + "?v=" + targetVersion // Remove trailing slash for consistency
					}
					if fragment != "" {
						source = strings.TrimSuffix(source, "/") + "#" + fragment // Remove trailing slash for consistency
					}
				}
				if isDeleted {
					deletedList = append(deletedList, source)
				}
				event := activity.Event{
					Data: &activity.Event_NewBlob{NewBlob: &activity.NewBlobEvent{
						Cid:        sourceBlob,
						BlobType:   linkType,
						Author:     author,
						Resource:   source,
						ExtraAttrs: extraAttrs,
						BlobId:     blobID,
						IsPinned:   isPinned,
					}},
					Account:     author,
					EventTime:   eventTime,
					ObserveTime: observeTime,
				}
				events = append(events, &event)
				cursorTS = append(cursorTS, structTsMillis)
				return nil
			}, args...); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	if len(events) == 0 {
		return &activity.ListEventsResponse{}, nil
	}

	var movedResources []entities.MovedResource
	genesisBlobJson := "[" + strings.Join(genesisBlobIDs, ",") + "]"
	err = srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, entities.QGetMovedBlocks(), func(stmt *sqlite.Stmt) error {
			var heads []head
			if err := json.Unmarshal(stmt.ColumnBytes(3), &heads); err != nil {
				return err
			}
			movedResources = append(movedResources, entities.MovedResource{
				NewIri:    stmt.ColumnText(0),
				OldIri:    stmt.ColumnText(1),
				IsDeleted: stmt.ColumnInt(2) == 1,
			})
			return nil
		}, genesisBlobJson)
	})
	if err != nil {
		return nil, err
	}
	for _, movedResource := range movedResources {
		for i, e := range events {
			if strings.Contains(e.Data.(*activity.Event_NewBlob).NewBlob.Resource, movedResource.OldIri) {
				if movedResource.IsDeleted {
					deletedList = append(deletedList, e.Data.(*activity.Event_NewBlob).NewBlob.Resource)
				} else {
					events[i].Data.(*activity.Event_NewBlob).NewBlob.Resource = strings.ReplaceAll(events[i].Data.(*activity.Event_NewBlob).NewBlob.Resource, movedResource.OldIri, movedResource.NewIri)
				}
			}
		}
	}

	nonDeleted := make([]*activity.Event, 0, len(events))
	for _, e := range events {
		if !slices.Contains(deletedList, e.Data.(*activity.Event_NewBlob).NewBlob.Resource) {
			nonDeleted = append(nonDeleted, e)
		}
	}

	//TODO: remove duplicates based on resource, type, author, eventtime
	seen := make(map[string]struct{})
	for i := 0; i < len(nonDeleted); i++ {
		e := nonDeleted[i]
		key := fmt.Sprintf("%s:%s:%s:%d",
			e.Data.(*activity.Event_NewBlob).NewBlob.Resource,
			e.Data.(*activity.Event_NewBlob).NewBlob.BlobType,
			e.Account,
			e.EventTime.AsTime().UnixNano())
		if _, ok := seen[key]; ok {
			nonDeleted = append(nonDeleted[:i], nonDeleted[i+1:]...)
			i--
		} else {
			seen[key] = struct{}{}
		}
	}

	// Sort by EventTime for display, but paginate using structural ts (ms).
	idx := make([]int, len(nonDeleted))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(i, j int) bool {
		return nonDeleted[idx[i]].EventTime.AsTime().After(nonDeleted[idx[j]].EventTime.AsTime())
	})
	sortedEvents := make([]*activity.Event, len(nonDeleted))
	sortedCursorTS := make([]int64, len(cursorTS))
	for k, i := range idx {
		sortedEvents[k] = nonDeleted[i]
		sortedCursorTS[k] = cursorTS[i]
	}
	events = sortedEvents
	cursorTS = sortedCursorTS

	// Apply page size to both arrays.
	pageLen := int(math.Min(float64(len(events)), float64(req.PageSize)))
	events = events[:pageLen]
	cursorTS = cursorTS[:pageLen]

	// Next page token based on the minimum structural ts (ms) in the returned page.
	var nextPageToken string
	if pageLen > 0 && int(req.PageSize) == pageLen {
		minTS := cursorTS[0]
		for _, ts := range cursorTS[1:] {
			if ts != 0 && (minTS == 0 || ts < minTS) {
				minTS = ts
			}
		}
		if minTS != 0 {
			nextPageToken, err = apiutil.EncodePageToken(minTS-1, nil)
			if err != nil {
				return nil, fmt.Errorf("failed to encode next page token: %w", err)
			}
		}
	}

	return &activity.ListEventsResponse{
		Events:        events,
		NextPageToken: nextPageToken,
	}, err
}

var qGetLatestVersions = dqb.Str(`
SELECT
resources.iri,
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
) AS heads
FROM document_generations
JOIN resources ON resources.id = document_generations.resource
WHERE resources.iri in (SELECT value from json_each(:resources_json))
`)
var qGetChangesFromRefs = dqb.Str(`
WITH ids AS (
  SELECT value AS ref_id
  FROM json_each(:refBlobsJson)
)
SELECT
  hex(b.multihash) AS mh,
  b.codec,
  bl.source        AS ref_id,
  b.id             AS change_id
FROM blob_links bl
JOIN ids          ON ids.ref_id = bl.source
JOIN blobs b      ON b.id = bl.target;
`)

var qEntitiesLookupID = dqb.Str(`
	SELECT resources.id, 
	resources.iri
	FROM resources
	JOIN document_generations dg ON dg.resource = resources.id
	WHERE resources.iri GLOB :filter_resource
	AND dg.is_deleted = 0;
`)

var qGetIdsFromIris = dqb.Str(`
	SELECT resources.id
	FROM resources
	WHERE resources.iri IN (SELECT value from json_each(:iris_json))
`)

var qGetMovedBlocksByResourceID = dqb.Str(`
SELECT
  sb.extra_attrs->>'redirect' AS redirect,
  r.iri,
  dg.is_deleted
  from structural_blobs sb
  JOIN resources r ON r.id = sb.resource
  JOIN document_generations dg ON dg.resource = (SELECT id FROM resources WHERE iri = sb.extra_attrs->>'redirect')
  WHERE sb.type = 'Ref'
  AND sb.extra_attrs->>'redirect' != ''
  AND sb.genesis_blob IN (SELECT sb2.genesis_blob FROM structural_blobs sb2 JOIN resources r2 ON r2.id = sb2.resource WHERE r2.iri GLOB :filter_resource);
`)

var listMentionsCore string = `
WITH changes AS (
	SELECT distinct
	    structural_blobs.genesis_blob,
	    resource_links.id AS link_id,
	    resource_links.is_pinned,
	    blobs.codec,
	    blobs.multihash,
		blobs.id,
		structural_blobs.ts,
		public_keys.principal AS main_author,
	    resource_links.extra_attrs->>'a' AS anchor,
		resource_links.extra_attrs->>'v' AS target_version,
		resource_links.extra_attrs->>'f' AS target_fragment,
		resource_links.type AS link_type,
		structural_blobs.extra_attrs->>'tsid' AS tsid
	FROM resource_links
	JOIN structural_blobs ON structural_blobs.id = resource_links.source
	JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
	JOIN public_keys ON public_keys.id = structural_blobs.author
	LEFT JOIN resources ON resources.id = structural_blobs.resource
	WHERE resource_links.target IN (SELECT value from json_each(:targets_json))
	AND structural_blobs.type IN ('Change')
	AND structural_blobs.ts <= :idx
)
SELECT distinct
    resources.iri,
    blobs.codec,
    blobs.multihash,
	public_keys.principal AS main_author,
    structural_blobs.ts,
    structural_blobs.type AS blob_type,
    resource_links.is_pinned,
    resource_links.extra_attrs->>'a' AS anchor,
	resource_links.extra_attrs->>'v' AS target_version,
	resource_links.extra_attrs->>'f' AS target_fragment,
	resource_links.type AS link_type,
    blobs.id AS blob_id,
	blobs.insert_time AS blob_insert_time,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	structural_blobs.extra_attrs,
	resource_links.id AS link_id,
	structural_blobs.extra_attrs->>'deleted' as is_deleted,
	structural_blobs.genesis_blob
FROM resource_links
JOIN structural_blobs ON structural_blobs.id = resource_links.source
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
WHERE resource_links.target IN (SELECT value from json_each(:targets_json))
`
var authorsFilterMentions = `
AND upper(hex(main_author)) IN (SELECT value from json_each(:authors_json))
`
var linkTypesFilterMentions = `
AND lower(link_type) IN (SELECT value from json_each(:link_types_json))
`
var pagingMentions = `
AND structural_blobs.ts <= :idx
AND structural_blobs.type IN ('Comment')
UNION ALL
SELECT distinct
    resources.iri,
    blobs.codec,
    blobs.multihash,
    public_keys.principal AS main_author,
    changes.ts,
    'Ref' AS blob_type,
    changes.is_pinned,
    changes.anchor,
	changes.target_version,
	changes.target_fragment,
	changes.link_type AS link_type,
    blobs.id AS blob_id,
	blobs.insert_time AS blob_insert_time,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	structural_blobs.extra_attrs,
	changes.link_id,
	structural_blobs.extra_attrs->>'deleted' as is_deleted,
	changes.genesis_blob
FROM structural_blobs
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
JOIN changes ON (((changes.genesis_blob = structural_blobs.genesis_blob OR changes.id = structural_blobs.genesis_blob) AND structural_blobs.type = 'Ref') OR (changes.id = structural_blobs.id AND structural_blobs.type = 'Comment'))
WHERE structural_blobs.ts <= :idx
`
var limitMentions = `
GROUP BY resources.iri, changes.link_id, target_version, target_fragment
ORDER BY structural_blobs.ts DESC
LIMIT :page_size;
`
