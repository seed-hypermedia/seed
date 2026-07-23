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
	telemetry "seed/backend/api/telemetry/v1alpha"
	"seed/backend/blob"
	"seed/backend/core"
	activity "seed/backend/genproto/activity/v1alpha"
	entity_proto "seed/backend/genproto/entities/v1alpha"
	"seed/backend/hmnet/syncing"
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

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/ipfs/go-cid"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// feedEmittedSeenCapacity bounds the dedup set for backend.feed_emitted
// stamps. 4096 unique blob keys covers a very busy session without
// growing unbounded; entries roll off LRU-style.
const feedEmittedSeenCapacity = 4096

// Server implements the Activity gRPC API.
type Server struct {
	db        *sqlitex.Pool
	startTime time.Time
	clean     *cleanup.Stack
	log       *zap.Logger
	sync      *syncing.Service
	telemetry *telemetry.Server

	// feedEmittedSeen bounds-deduplicates backend.feed_emitted stamps:
	// the frontend polls ListEvents every few seconds, so without this
	// cache the same blob would re-stamp the same key on every poll,
	// drowning /debug/journeys in tens of minutes of identical
	// feed_emitted rows for the same key.
	feedEmittedSeen *lru.Cache[string, struct{}]
}

// SetTelemetry attaches a Telemetry server so ListEvents can emit
// backend.feed_emitted checkpoints for each new-blob event.
func (srv *Server) SetTelemetry(t *telemetry.Server) {
	srv.telemetry = t
}

type head struct {
	Multihash string `json:"multihash"`
	Codec     uint64 `json:"codec"`
}

const (
	feedCursorKindBlob = iota
	feedCursorKindMention
)

type feedCursor struct {
	cursorValue int64
	blobID      int64
	kind        int
	linkID      int64
	key         string
}

var resourcePattern = regexp.MustCompile(`^hm://[a-zA-Z0-9*]+/?[a-zA-Z0-9*-/]*$`)

// NewServer creates a new Server.
func NewServer(db *sqlitex.Pool, log *zap.Logger, clean *cleanup.Stack, sync *syncing.Service) *Server {
	// lru.New only returns an error for capacity <= 0, which we control
	// at compile time.
	cache, _ := lru.New[string, struct{}](feedEmittedSeenCapacity)
	return &Server{
		db:              db,
		startTime:       time.Now(),
		clean:           clean,
		log:             log,
		sync:            sync,
		feedEmittedSeen: cache,
	}
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	activity.RegisterActivityFeedServer(rpc, srv)
	activity.RegisterSubscriptionsServer(rpc, srv)
}

// ListEvents list all the events seen locally.
func (srv *Server) ListEvents(ctx context.Context, req *activity.ListEventsRequest) (*activity.ListEventsResponse, error) {
	var cursorValue int64 = math.MaxInt64
	if req.PageToken != "" {
		if err := apiutil.DecodePageToken(req.PageToken, &cursorValue, nil); err != nil {
			return nil, fmt.Errorf("failed to decode page token: %w", err)
		}
	}
	var events []*activity.Event
	// Track the feed-order cursor used for DB paging and stable same-blob
	// tie-breaking, aligned with events slice.
	var eventCursors []feedCursor
	orderByObserved := req.Order == activity.FeedOrder_FEED_ORDER_OBSERVED_TIME
	srv.log.Debug("Listing events", zap.Int64("cursor_value", cursorValue), zap.String("order", req.Order.String()))
	var filtersStr string
	var authorsJSON, linkTypesJSON string

	filterResource := "*"
	noResourceFilter := req.FilterResource == "" || req.FilterResource == "*"
	if len(req.FilterResource) > 0 {
		if !resourcePattern.MatchString(req.FilterResource) {
			return nil, fmt.Errorf("Invalid resource format [%s]", req.FilterResource)
		}
		filterResource = req.FilterResource
	}
	// initialMovedResources and initialEidsUpdated are only populated when the
	// caller passed an explicit FilterResource. In the unfiltered ("*") path
	// the IN(...) list these feed would explode to every non-deleted resource,
	// which forces the planner to scan all resource_links — see the package
	// hot-path tuning notes in ListEvents below.
	var initialMovedResources map[string]string = make(map[string]string)
	var initialEidsUpdated []string
	if !noResourceFilter {
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.ExecTransient(conn, qGetMovedBlocksByResourceID(), func(stmt *sqlite.Stmt) error {
				isDeleted := stmt.ColumnInt(2) == 1
				if !isDeleted {
					initialMovedResources[stmt.ColumnText(0)] = stmt.ColumnText(1)
				}
				return nil
			}, filterResource)
		}); err != nil {
			return nil, err
		}
		var initialIris []string
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			if err := sqlitex.ExecTransient(conn, qEntitiesLookupID(), func(stmt *sqlite.Stmt) error {
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
		for _, iri := range initialIris {
			oldIri, ok := initialMovedResources[iri]
			initialEidsUpdated = append(initialEidsUpdated, iri)
			if ok {
				initialEidsUpdated = append(initialEidsUpdated, oldIri)
			}
		}
	}
	filterAuthors, err := srv.expandFilterAuthors(ctx, req.FilterAuthors)
	if err != nil {
		return nil, err
	}
	if len(filterAuthors) > 0 {
		filtersStr = storage.PublicKeysPrincipal.String() + " in ("
		authorsJSON = "["
		for i, user := range filterAuthors {
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
	if !noResourceFilter {
		if len(initialEidsUpdated) == 0 {
			return &activity.ListEventsResponse{}, nil
		}
		filtersStr += storage.ResourcesIRI.String() + " IN ('" + strings.Join(initialEidsUpdated, "', '") + "')"
		filtersStr += " AND "
	}
	var (
		selectStr            = "SELECT distinct " + storage.BlobsID + ", " + storage.StructuralBlobsType + ", " + storage.PublicKeysPrincipal + ", " + storage.ResourcesIRI + ", " + storage.StructuralBlobsTs + ", " + storage.BlobsInsertTime + ", " + storage.BlobsMultihash + ", " + storage.BlobsCodec + ", " + "structural_blobs.extra_attrs->>'tsid' AS tsid" + ", " + "structural_blobs.extra_attrs" + ", " + storage.StructuralBlobsGenesisBlob
		tableStr             = "FROM " + storage.T_StructuralBlobs
		joinIDStr            = "JOIN " + storage.Blobs.String() + " ON " + storage.BlobsID.String() + "=" + storage.StructuralBlobsID.String()
		joinpkStr            = "JOIN " + storage.PublicKeys.String() + " ON " + storage.StructuralBlobsAuthor.String() + "=" + storage.PublicKeysID.String()
		leftjoinResourcesStr = "LEFT JOIN " + storage.Resources.String() + " ON " + storage.StructuralBlobsResource.String() + "=" + storage.ResourcesID.String()

		mainCursorColumn = storage.StructuralBlobsTs.String()
	)
	if orderByObserved {
		mainCursorColumn = storage.StructuralBlobsID.String()
	}
	pageTokenStr := mainCursorColumn + " <= :idx AND " + storage.StructuralBlobsType.String() + " != 'Change' AND " + storage.BlobsSize.String() + ">0 ORDER BY " + mainCursorColumn + " desc limit :page_size"
	if req.PageSize <= 0 {
		req.PageSize = 30
	}
	var getEventsStr = strings.TrimSpace(fmt.Sprintf(`
		%s
		%s
		%s
		%s
		%s
		WHERE %s %s;
	`, selectStr, tableStr, joinIDStr, joinpkStr, leftjoinResourcesStr, filtersStr, pageTokenStr))
	var refIDs, resources, genesisBlobIDs []string
	// Count rows returned by the main DB fetch (pre-filter). Used to decide whether to
	// emit a next-page token even if the deleted/dedup filters shorten the visible page.
	var mainRawCount int
	// Smallest cursor value returned by the main DB fetch (rows stream in
	// cursor-descending order, so the last row sets it). Together with
	// mentionsScanFloor this bounds how deep the merged page may reach — see
	// the coverageFloor clamp below.
	var mainScanFloor int64
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		err := sqlitex.ExecTransient(conn, getEventsStr, func(stmt *sqlite.Stmt) error {
			mainRawCount++
			id := stmt.ColumnInt64(0)
			eventType := stmt.ColumnText(1)
			author := stmt.ColumnBytes(2)
			resource := stmt.ColumnText(3)
			// Structural timestamp (ms) is the event's authored timestamp.
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
				if resource != "" {
					var attrs map[string]any
					if err := json.Unmarshal([]byte(extraAttrs), &attrs); err == nil {
						attrs["target"] = resource
						if b, err := json.Marshal(attrs); err == nil {
							extraAttrs = string(b)
						}
					}
				}
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
			cursor := structTsMillis
			if orderByObserved {
				cursor = id
			}
			mainScanFloor = cursor
			eventCursors = append(eventCursors, feedCursor{
				cursorValue: cursor,
				blobID:      id,
				kind:        feedCursorKindBlob,
				key:         cID.String(),
			})
			genesisBlobIDs = append(genesisBlobIDs, strconv.FormatInt(stmt.ColumnInt64(10), 10))
			return nil
		}, cursorValue, req.PageSize)
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
		if err := sqlitex.ExecTransient(conn, qGetChangesFromRefs(), func(stmt *sqlite.Stmt) error {
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
		if err := sqlitex.ExecTransient(conn, qGetLatestVersions(), func(stmt *sqlite.Stmt) error {
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
				srv.log.Debug("Missing version for Ref blob", zap.Int64("blob_id", e.Data.(*activity.Event_NewBlob).NewBlob.BlobId))
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

	// Count rows returned by the mentions DB fetch (pre-filter). Used together with
	// mainRawCount to decide whether more pages exist after post-fetch filtering.
	var mentionsRawCount int
	// Smallest cursor value returned by the mentions DB fetch (same contract
	// as mainScanFloor).
	var mentionsScanFloor int64

	// Add mentions to the events list
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		// In the unfiltered (noResourceFilter) path we skip the IRI→id
		// resolution entirely and use the no-targets variant of the
		// mentions query — the IN(...) list would otherwise blow up to
		// every non-deleted resource id and force a full resource_links
		// scan even though the filter is semantically a no-op.
		var queryStr string
		var args []interface{}
		if noResourceFilter {
			queryStr = listMentionsCoreNoTargets
			args = []interface{}{cursorValue}
		} else {
			var eids []string
			irisJSON := "['" + strings.Join(initialEidsUpdated, "', '") + "']"
			if err := sqlitex.ExecTransient(conn, qGetIdsFromIris(), func(stmt *sqlite.Stmt) error {
				eid := stmt.ColumnInt64(0)
				if eid == 0 {
					return nil
				}
				eids = append(eids, strconv.FormatInt(eid, 10))
				return nil

			}, irisJSON); err != nil {
				return err
			}
			if len(eids) == 0 {
				return nil
			}
			eidsJSON := "[" + strings.Join(eids, ",") + "]"
			queryStr = listMentionsCore
			args = []interface{}{eidsJSON, cursorValue}
		}
		if !orderByObserved {
			queryStr = strings.Replace(queryStr, "structural_blobs.id <= :idx", "structural_blobs.ts <= :idx", 1)
		}

		if len(authorsJSON) > 2 {
			queryStr += authorsFilterMentions
			args = append(args, authorsJSON)
		}
		if len(linkTypesJSON) > 2 {
			queryStr += linkTypesFilterMentions
			args = append(args, linkTypesJSON)
		}
		if orderByObserved {
			queryStr += limitMentionsByObserved
		} else {
			queryStr += limitMentionsByClaimed
		}
		args = append(args, req.PageSize)
		queryStr = strings.TrimSpace(queryStr)
		if err := sqlitex.ExecTransient(conn, queryStr, func(stmt *sqlite.Stmt) error {
			mentionsRawCount++
			var (
				sourceDoc  string
				target     = stmt.ColumnText(0)
				sourceBlob = cid.NewCidV1(uint64(stmt.ColumnInt64(1)), stmt.ColumnBytesUnsafe(2)).String()
				author     = core.Principal(stmt.ColumnBytesUnsafe(3)).String()
				// Structural timestamp (ms) is the event's authored timestamp.
				structTsMillis = stmt.ColumnInt64(4)
				eventTime      = timestamppb.New(time.UnixMilli(structTsMillis))
				blobType       = stmt.ColumnText(5)

				isPinned      = stmt.ColumnInt(6) > 0
				anchor        = stmt.ColumnText(7)
				targetVersion = stmt.ColumnText(8)
				fragment      = stmt.ColumnText(9)

				linkType    = stmt.ColumnText(10)
				blobID      = stmt.ColumnInt64(11)
				observeTime = timestamppb.New(time.Unix(stmt.ColumnInt64(12), 0))
				tsid        = blob.TSID(stmt.ColumnText(13))
				//extraAttrs  = stmt.ColumnText(14)
				linkID         = stmt.ColumnInt64(15)
				isDeleted      = stmt.ColumnText(16) == "1"
				source         = stmt.ColumnText(18)
				sourceResource = stmt.ColumnText(19)
			)
			genesisBlobIDs = append(genesisBlobIDs, strconv.FormatInt(stmt.ColumnInt64(17), 10))
			if target == "" && blobType != "Comment" {
				return fmt.Errorf("BUG: missing target for link of type '%s'", blobType)
			}

			if blobType == "Comment" {
				sourceDoc = sourceResource
				source = "hm://" + author + "/" + tsid.String()
				eventTime = timestamppb.New(tsid.Timestamp())

			}
			if isDeleted {
				deletedList = append(deletedList, target)
			}
			event := activity.Event{
				Data: &activity.Event_NewMention{NewMention: &entity_proto.Mention{
					Source:        source,
					SourceType:    linkType,
					SourceContext: anchor,
					SourceBlob: &entity_proto.Mention_BlobInfo{
						Cid:        sourceBlob,
						Author:     author,
						CreateTime: eventTime,
					},
					IsExactVersion: isPinned,
					SourceDocument: sourceDoc,
					Target:         target,
					TargetVersion:  targetVersion,
					TargetFragment: fragment,
				}},
				Account:     author,
				EventTime:   eventTime,
				ObserveTime: observeTime,
			}
			events = append(events, &event)
			cursor := structTsMillis
			if orderByObserved {
				cursor = blobID
			}
			mentionsScanFloor = cursor
			eventCursors = append(eventCursors, feedCursor{
				cursorValue: cursor,
				blobID:      blobID,
				kind:        feedCursorKindMention,
				linkID:      linkID,
				key: strings.Join([]string{
					sourceBlob,
					linkType,
					target,
					targetVersion,
					fragment,
					source,
				}, "\x00"),
			})
			return nil
		}, args...); err != nil {
			return err
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
		return sqlitex.ExecTransient(conn, entities.QGetMovedBlocks(), func(stmt *sqlite.Stmt) error {
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
	events, eventCursors = filterDeletedAndDedupEvents(events, eventCursors, deletedList, movedResources, orderByObserved)

	// Each DB fetch above is limited to PageSize rows, so a fetch that filled
	// its limit only covered cursors down to its scan floor. The merged page
	// must not emit anything below the deepest such floor: the other fetch
	// hasn't scanned that far yet, and the next-page token (the minimum cursor
	// of the page) would skip everything in between — events lost on every
	// subsequent page. Clamped events are re-fetched by the next page.
	var coverageFloor int64
	if mainRawCount >= int(req.PageSize) && mainScanFloor > coverageFloor {
		coverageFloor = mainScanFloor
	}
	if mentionsRawCount >= int(req.PageSize) && mentionsScanFloor > coverageFloor {
		coverageFloor = mentionsScanFloor
	}
	if coverageFloor > 0 {
		kept := events[:0]
		keptCursors := eventCursors[:0]
		for i, cursor := range eventCursors {
			if cursor.cursorValue != 0 && cursor.cursorValue < coverageFloor {
				continue
			}
			kept = append(kept, events[i])
			keptCursors = append(keptCursors, cursor)
		}
		events = kept
		eventCursors = keptCursors
	}

	// Apply page size to both arrays. If truncation cuts events, more pages
	// exist even when both DB fetches came back under-full.
	truncated := len(events) > int(req.PageSize)
	pageLen := int(math.Min(float64(len(events)), float64(req.PageSize)))
	events = events[:pageLen]
	eventCursors = eventCursors[:pageLen]

	if srv.telemetry != nil {
		now := time.Now()
		for _, e := range events {
			nb, ok := e.Data.(*activity.Event_NewBlob)
			if !ok {
				continue
			}
			key := newBlobTelemetryKey(nb.NewBlob)
			if key == "" {
				continue
			}
			// Dedupe: only stamp feed_emitted the first time we surface a
			// given blob key. The frontend polls ListEvents on a timer, so
			// without this filter the same key would re-stamp every poll
			// and turn /debug/journeys into a wall of identical rows.
			if srv.feedEmittedSeen != nil {
				if _, seen := srv.feedEmittedSeen.Get(key); seen {
					continue
				}
				srv.feedEmittedSeen.Add(key, struct{}{})
			}
			srv.telemetry.RecordCheckpoint(key, telemetry.StageFeedEmitted, now)
		}
	}

	// Next page token based on the minimum cursor value in the returned page.
	// Emit a token whenever either DB fetch returned a full batch, because the
	// deleted/dedup filters above can shorten the visible page below req.PageSize
	// while older rows remain in the database.
	rawHasMore := mainRawCount >= int(req.PageSize) || mentionsRawCount >= int(req.PageSize) || truncated
	var nextPageToken string
	if pageLen > 0 && rawHasMore {
		minCursor := eventCursors[0].cursorValue
		for _, cursor := range eventCursors[1:] {
			if cursor.cursorValue != 0 && (minCursor == 0 || cursor.cursorValue < minCursor) {
				minCursor = cursor.cursorValue
			}
		}
		if minCursor != 0 {
			nextPageToken = apiutil.EncodePageToken(minCursor-1, nil)
		}
	} else if pageLen == 0 && rawHasMore && coverageFloor > 0 {
		// Everything on this page was clamped or filtered out, but the DB has
		// more rows. Emit a token at the coverage boundary so the client can
		// keep paging instead of dead-ending on an empty page.
		nextPageToken = apiutil.EncodePageToken(coverageFloor-1, nil)
	}

	return &activity.ListEventsResponse{
		Events:        events,
		NextPageToken: nextPageToken,
	}, err
}

// filterDeletedAndDedupEvents removes events whose IRI is either in
// deletedTargets or substring-matches the OldIri of a deleted entry in
// movedResources, then sorts the survivors and dedups them.
//
// Dedup semantics mirror the previous inline implementation:
//   - seenMentionGroup replaces the SQL GROUP BY that used to live in
//     listMentionsCore (collapsing by target / target_version /
//     target_fragment / source so unrelated columns like rl.id, is_pinned,
//     anchor don't surface duplicate mention rows).
//   - seen collapses on (target-or-resource, source-type-or-blob-type,
//     account, event-time-nanoseconds); the same map is shared between
//     mentions and blobs to preserve cross-type dedup behavior.
//
// The function returns parallel slices of the survivors. It always allocates
// fresh output slices; callers can rebind their own variables to the result.
func filterDeletedAndDedupEvents(
	events []*activity.Event,
	cursors []feedCursor,
	deletedTargets []string,
	movedResources []entities.MovedResource,
	orderByObserved bool,
) ([]*activity.Event, []feedCursor) {
	if len(events) == 0 {
		return events, cursors
	}

	// Set of IRIs to drop. Seeded from the explicit deletedTargets list
	// (rows the mentions query already flagged isDeleted=1), then enriched
	// below from movedResources.
	deletedIRIs := make(map[string]struct{}, len(deletedTargets)+len(movedResources))
	for _, t := range deletedTargets {
		deletedIRIs[t] = struct{}{}
	}

	var deletedOldIRIs []string
	for _, mr := range movedResources {
		if mr.IsDeleted {
			deletedOldIRIs = append(deletedOldIRIs, mr.OldIri)
		}
	}

	// Extract each event's relevant IRI once. Empty string means the event
	// type is neither NewMention nor NewBlob; those events pass through
	// without being eligible for IRI-based deletion.
	eventIRIs := make([]string, len(events))
	for i, e := range events {
		switch d := e.Data.(type) {
		case *activity.Event_NewMention:
			eventIRIs[i] = d.NewMention.Source
		case *activity.Event_NewBlob:
			eventIRIs[i] = d.NewBlob.Resource
		}
	}

	// Substring-match against deleted moved-resource OldIris. Typically
	// len(deletedOldIRIs) is 0 or 1, so this stays cheap.
	if len(deletedOldIRIs) > 0 {
		for _, iri := range eventIRIs {
			if iri == "" {
				continue
			}
			if _, already := deletedIRIs[iri]; already {
				continue
			}
			for _, old := range deletedOldIRIs {
				if strings.Contains(iri, old) {
					deletedIRIs[iri] = struct{}{}
					break
				}
			}
		}
	}

	// Single-pass filter via map lookup.
	nonDeleted := make([]*activity.Event, 0, len(events))
	nonDeletedCursors := make([]feedCursor, 0, len(cursors))
	for i, e := range events {
		if iri := eventIRIs[i]; iri != "" {
			if _, ok := deletedIRIs[iri]; ok {
				continue
			}
		}
		nonDeleted = append(nonDeleted, e)
		nonDeletedCursors = append(nonDeletedCursors, cursors[i])
	}

	// Sort before dedup so first-match-wins is deterministic.
	sortFeedEvents(nonDeleted, nonDeletedCursors, orderByObserved)

	seen := make(map[string]struct{}, len(nonDeleted))
	seenMentionGroup := make(map[string]struct{}, len(nonDeleted))
	out := make([]*activity.Event, 0, len(nonDeleted))
	outCursors := make([]feedCursor, 0, len(nonDeleted))
	for i, e := range nonDeleted {
		switch d := e.Data.(type) {
		case *activity.Event_NewMention:
			nm := d.NewMention
			groupKey := nm.Target + "\x00" + nm.TargetVersion + "\x00" + nm.TargetFragment + "\x00" + nm.Source
			if _, ok := seenMentionGroup[groupKey]; ok {
				continue
			}
			seenMentionGroup[groupKey] = struct{}{}
			key := nm.Target + "\x00" + nm.SourceType + "\x00" + e.Account + "\x00" + strconv.FormatInt(e.EventTime.AsTime().UnixNano(), 10)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
		case *activity.Event_NewBlob:
			nb := d.NewBlob
			key := nb.Resource + "\x00" + nb.BlobType + "\x00" + e.Account + "\x00" + strconv.FormatInt(e.EventTime.AsTime().UnixNano(), 10)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
		}
		out = append(out, e)
		outCursors = append(outCursors, nonDeletedCursors[i])
	}
	return out, outCursors
}

func sortFeedEvents(events []*activity.Event, cursors []feedCursor, orderByObserved bool) {
	idx := make([]int, len(events))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(i, j int) bool {
		aIdx := idx[i]
		bIdx := idx[j]
		a := cursors[aIdx]
		b := cursors[bIdx]
		if orderByObserved {
			if a.cursorValue != b.cursorValue {
				return a.cursorValue > b.cursorValue
			}
		} else if cmp := events[aIdx].EventTime.AsTime().Compare(events[bIdx].EventTime.AsTime()); cmp != 0 {
			return cmp > 0
		}
		switch {
		case a.blobID != b.blobID:
			return a.blobID > b.blobID
		case a.kind != b.kind:
			return a.kind < b.kind
		case a.linkID != b.linkID:
			return a.linkID < b.linkID
		default:
			return a.key < b.key
		}
	})

	sortedEvents := make([]*activity.Event, len(events))
	sortedCursors := make([]feedCursor, len(cursors))
	for k, i := range idx {
		sortedEvents[k] = events[i]
		sortedCursors[k] = cursors[i]
	}
	copy(events, sortedEvents)
	copy(cursors, sortedCursors)
}

// newBlobTelemetryKey builds the correlation key used by the journeys
// profiler for an activity event. The frontend constructs the same string
// from the wire form of NewBlobEvent, so both processes' checkpoints join.
//
// For Ref blobs the Resource field already has "?v=<version>" appended by
// ListEvents; we use it verbatim. For other blob types we append
// "?v=<blob_cid>" — the blob CID *is* the head for those types.
func newBlobTelemetryKey(nb *activity.NewBlobEvent) string {
	if nb == nil || nb.Resource == "" {
		return ""
	}
	if strings.Contains(nb.Resource, "?v=") {
		return nb.Resource
	}
	if nb.Cid == "" {
		return nb.Resource
	}
	return nb.Resource + "?v=" + nb.Cid
}

func (srv *Server) expandFilterAuthors(ctx context.Context, authors []string) ([]string, error) {
	if len(authors) == 0 {
		return nil, nil
	}

	return sqlitex.Read(ctx, srv.db, func(conn *sqlite.Conn) ([]string, error) {
		expanded := make([]string, 0, len(authors))
		queue := append([]string(nil), authors...)
		seen := make(map[string]struct{}, len(authors))

		for len(queue) > 0 {
			author := queue[0]
			queue = queue[1:]

			if _, ok := seen[author]; ok {
				continue
			}

			principal, err := core.DecodePrincipal(author)
			if err != nil {
				return nil, fmt.Errorf("invalid user filter [%s]: %w", author, err)
			}

			seen[author] = struct{}{}
			expanded = append(expanded, author)

			if err := sqlitex.ExecTransient(conn, qListCurrentAliasAuthors(), func(stmt *sqlite.Stmt) error {
				aliasAuthor := core.Principal(stmt.ColumnBytes(0)).String()
				if _, ok := seen[aliasAuthor]; !ok {
					queue = append(queue, aliasAuthor)
				}
				return nil
			}, principal); err != nil {
				return nil, err
			}
		}

		slices.Sort(expanded)
		return expanded, nil
	})
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

var qListCurrentAliasAuthors = dqb.Str(`
WITH target AS (
	SELECT id
	FROM public_keys
	WHERE principal = ?
),
candidate_authors AS (
	SELECT DISTINCT sb.author
	FROM structural_blobs sb
	JOIN target ON target.id = sb.extra_attrs->>'alias'
	WHERE sb.type = 'Profile'
),
latest_profiles AS (
	SELECT
		sb.author,
		CAST(sb.extra_attrs->>'alias' AS INTEGER) AS alias_id,
		ROW_NUMBER() OVER (PARTITION BY sb.author ORDER BY sb.ts DESC, sb.id DESC) AS rn
	FROM structural_blobs sb
	JOIN resources r ON r.id = sb.resource
	JOIN candidate_authors ca ON ca.author = sb.author
	WHERE sb.type = 'Profile'
	AND r.owner = sb.author
)
SELECT pk.principal
FROM latest_profiles lp
JOIN public_keys pk ON pk.id = lp.author
WHERE lp.rn = 1
AND lp.alias_id = (SELECT id FROM target);
`)

// listMentionsCoreSelect is the shared SELECT/FROM/JOIN prefix for the
// mentions query. The trailing WHERE clause is appended by callers via
// listMentionsCore (filtered) or listMentionsCoreNoTargets (unfiltered).
//
// Historical note: the trailing GROUP BY that used to live here was moved
// into Go-side dedup (see the seenGroup loop in ListEvents). The GROUP BY
// forced a TEMP B-TREE that materialised the full candidate set before
// LIMIT 30 could apply, which blew the wall time to 100-180ms; removing
// it lets the planner stream rows in structural_blobs.id DESC order and
// short-circuit at LIMIT.
var listMentionsCoreSelect = `
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
	CASE
        WHEN structural_blobs.type != 'Change' THEN structural_blobs.genesis_blob
        ELSE coalesce(structural_blobs.genesis_blob, structural_blobs.id)
    END AS effective_genesis,
	r2.iri AS source_iri,
	source_resources.iri AS source_resource_iri
FROM resource_links
JOIN structural_blobs ON structural_blobs.id = resource_links.source
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
JOIN resources ON resources.id = resource_links.target
LEFT JOIN resources r2
  ON r2.genesis_blob = CASE
        WHEN structural_blobs.type != 'Change' THEN structural_blobs.genesis_blob
        ELSE coalesce(structural_blobs.genesis_blob, structural_blobs.id)
     END
LEFT JOIN resources source_resources ON source_resources.id = structural_blobs.resource
`

// listMentionsCore is the filtered variant: WHERE constrains target to the
// caller-supplied set of resource ids. Used when req.FilterResource is set.
var listMentionsCore = listMentionsCoreSelect + `
WHERE resource_links.target IN (SELECT value from json_each(:targets_json))
AND structural_blobs.id <= :idx
`

// listMentionsCoreNoTargets drops the target IN(...) predicate. Used in the
// unfiltered path where the IN list would otherwise expand to every known
// resource (a semantic no-op that nevertheless forces a full scan).
var listMentionsCoreNoTargets = listMentionsCoreSelect + `
WHERE structural_blobs.id <= :idx
`

var authorsFilterMentions = `
AND upper(hex(main_author)) IN (SELECT value from json_each(:authors_json))
`
var linkTypesFilterMentions = `
AND lower(link_type) IN (SELECT value from json_each(:link_types_json))
`
var limitMentionsByObserved = `
ORDER BY structural_blobs.id DESC
LIMIT :page_size;
`

var limitMentionsByClaimed = `
ORDER BY structural_blobs.ts DESC
LIMIT :page_size;
`
