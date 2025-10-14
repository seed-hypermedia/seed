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
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
	srv.log.Info("Listing events", zap.Int64("cursor_blob_id", cursorBlobID))
	var filtersStr string
	if len(req.FilterAuthors) > 0 {
		filtersStr = storage.PublicKeysPrincipal.String() + " in ("
		for i, user := range req.FilterAuthors {
			if i > 0 {
				filtersStr += ", "
			}
			principal, err := core.DecodePrincipal(user)
			if err != nil {
				return nil, fmt.Errorf("Invalid user filter [%s]: %w", user, err)
			}
			filtersStr += "unhex('" + strings.ToUpper(hex.EncodeToString(principal)) + "')"
		}
		filtersStr += ") AND "
	}

	if len(req.FilterEventType) > 0 {
		filtersStr += "lower(" + storage.StructuralBlobsType.String() + ") in ("
		for i, eventType := range req.FilterEventType {
			// Hardcode this to prevent injection attacks
			if strings.ToLower(eventType) != "capability" && strings.ToLower(eventType) != "ref" && strings.ToLower(eventType) != "comment" && strings.ToLower(eventType) != "dagpb" && strings.ToLower(eventType) != "profile" && strings.ToLower(eventType) != "contact" {
				return nil, fmt.Errorf("Invalid event type filter [%s]: Only Capability | Ref | Comment | DagPB | Profile | Contact are supported at the moment", eventType)
			}
			if i > 0 {
				filtersStr += ", "
			}
			filtersStr += "'" + strings.ToLower(eventType) + "'"
		}
		filtersStr += ") AND "
	}
	if len(req.FilterResource) > 0 {
		if !resourcePattern.MatchString(req.FilterResource) {
			return nil, fmt.Errorf("Invalid resource format [%s]", req.FilterResource)
		}
		filtersStr += storage.ResourcesIRI.String() + " GLOB '" + strings.TrimSuffix(req.FilterResource, "/") + "'"
		filtersStr += " AND "
	}
	var (
		selectStr            = "SELECT distinct " + storage.BlobsID + ", " + storage.StructuralBlobsType + ", " + storage.PublicKeysPrincipal + ", " + storage.ResourcesIRI + ", " + storage.StructuralBlobsTs + ", " + storage.BlobsInsertTime + ", " + storage.BlobsMultihash + ", " + storage.BlobsCodec + ", " + "structural_blobs.extra_attrs->>'tsid' AS tsid" + ", " + "structural_blobs.extra_attrs"
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

	pageSize := req.PageSize
	if len(req.AddLinkedResource) > 0 {
		pageSize = req.PageSize * 2
	}
	var refIDs, resources []string
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
			return nil
		}, cursorBlobID, pageSize)
		if err != nil {
			return fmt.Errorf("Problem collecting activity feed, Probably no feed or token out of range: %w", err)
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
	if len(req.AddLinkedResource) > 0 {
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			var eids []string
			if err := sqlitex.Exec(conn, qEntitiesLookupID(), func(stmt *sqlite.Stmt) error {
				eid := stmt.ColumnInt64(0)
				if eid == 0 {
					return nil
				}
				eids = append(eids, strconv.FormatInt(eid, 10))
				return nil

			}, strings.Join(req.AddLinkedResource, ",")); err != nil {
				return err
			}

			if len(eids) == 0 {
				return status.Errorf(codes.NotFound, "none of the entities provided were found '%s'", req.AddLinkedResource)
			}
			if err := sqlitex.Exec(conn, qListMentions(), func(stmt *sqlite.Stmt) error {

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
					isDeleted   = stmt.ColumnText(15) == "1"
				)

				//srv.log.Info("Processing mention", zap.Bool("isPinned", isPinned), zap.String("anchor", anchor), zap.String("targetVersion", targetVersion), zap.String("fragment", fragment))
				if source == "" && blobType != "Comment" {
					return fmt.Errorf("BUG: missing source for mention of type '%s'", blobType)
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
			}, strings.Join(eids, ","), cursorBlobID, req.PageSize); err != nil {
				return err
			}

			return nil
		}); err != nil {
			return nil, err
		}
	}

	if len(events) == 0 {
		return &activity.ListEventsResponse{}, nil
	}
	nonDeleted := make([]*activity.Event, 0, len(events))
	for _, e := range events {
		if !slices.Contains(deletedList, e.Data.(*activity.Event_NewBlob).NewBlob.Resource) {
			nonDeleted = append(nonDeleted, e)
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
	var err error
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
	SELECT resources.id
	FROM resources
	WHERE resources.iri = :entities_eid
	LIMIT 1
`)

var qListMentions = dqb.Str(`
WITH changes AS (
	SELECT distinct
	    structural_blobs.genesis_blob,
	    resource_links.id AS link_id,
	    resource_links.is_pinned,
	    blobs.codec,
	    blobs.multihash,
		blobs.id,
		structural_blobs.ts,
		public_keys.principal AS author,
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
	WHERE resource_links.target IN (:targets)
	AND structural_blobs.type IN ('Change')
	AND structural_blobs.ts <= :idx
)
SELECT distinct
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
	resource_links.type AS link_type,
    blobs.id AS blob_id,
	blobs.insert_time AS blob_insert_time,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	structural_blobs.extra_attrs,
	resource_links.id AS link_id,
	structural_blobs.extra_attrs->>'deleted' as is_deleted
FROM resource_links
JOIN structural_blobs ON structural_blobs.id = resource_links.source
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
WHERE resource_links.target IN (:targets)
AND structural_blobs.ts <= :idx
AND structural_blobs.type IN ('Comment')
UNION ALL
SELECT distinct
    resources.iri,
    blobs.codec,
    blobs.multihash,
    public_keys.principal AS author,
    changes.ts,
    'Ref' AS blob_type,
    changes.is_pinned,
    changes.anchor,
	changes.target_version,
	changes.target_fragment,
	changes.link_type link_type,
    blobs.id AS blob_id,
	blobs.insert_time AS blob_insert_time,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	structural_blobs.extra_attrs,
	changes.link_id,
	structural_blobs.extra_attrs->>'deleted' as is_deleted
FROM structural_blobs
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
JOIN changes ON (((changes.genesis_blob = structural_blobs.genesis_blob OR changes.id = structural_blobs.genesis_blob) AND structural_blobs.type = 'Ref') OR (changes.id = structural_blobs.id AND structural_blobs.type = 'Comment'))
WHERE structural_blobs.ts <= :idx
GROUP BY resources.iri, changes.link_id, target_version, target_fragment
ORDER BY structural_blobs.ts DESC
LIMIT :page_size;
`)
