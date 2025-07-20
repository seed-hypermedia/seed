// Package activity manages the activity feed.
package activity

import (
	"context"
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"seed/backend/core"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/storage"
	"strings"
	"time"

	"seed/backend/hmnet/syncing"
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
	SyncSubscribedContent(context.Context, ...*activity.Subscription) (syncing.SyncResult, error)
}

// Server implements the Activity gRPC API.
type Server struct {
	db        *sqlitex.Pool
	startTime time.Time
	clean     *cleanup.Stack
	log       *zap.Logger
	syncer    syncer
}

var resourcePattern = regexp.MustCompile(`^hm://[a-zA-Z0-9*]+/?[a-zA-Z0-9*]*$`)

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
	var cursorBlobID int64 = math.MaxInt32
	if req.PageToken != "" {
		if err := apiutil.DecodePageToken(req.PageToken, &cursorBlobID, nil); err != nil {
			return nil, fmt.Errorf("failed to decode page token: %w", err)
		}
	}

	var events []*activity.Event

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
				return nil, fmt.Errorf("Invalid event type filter [%s]: Only Capability | Ref | Comment | DagPB | Profile are supported at the moment", eventType)
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
	var linksStr string
	if len(req.AddLinkedResource) > 0 {
		if len(req.FilterResource) > 0 || len(req.FilterEventType) > 0 {
			linksStr += " OR "
		}
		linksStr += "(" + storage.StructuralBlobsType.String() + " in ('Change', 'Comment') AND " + storage.ResourceLinksTarget.String() + " IN (" +
			"select " + storage.ResourcesID.String() + " FROM " + storage.T_Resources + " where " + storage.ResourcesIRI.String() + " in ("
		for i, resource := range req.AddLinkedResource {
			if !resourcePattern.MatchString(resource) {
				return nil, fmt.Errorf("Invalid link resource format [%s]", resource)
			}
			if i > 0 {
				linksStr += ", "
			}
			linksStr += "'" + resource + "'"
		}
		linksStr += "))) AND "
	}
	var (
		selectStr            = "SELECT distinct " + storage.BlobsID + ", " + storage.StructuralBlobsType + ", " + storage.PublicKeysPrincipal + ", " + storage.ResourcesIRI + ", " + storage.StructuralBlobsTs + ", " + storage.BlobsInsertTime + ", " + storage.BlobsMultihash + ", " + storage.BlobsCodec + ", " + "structural_blobs.extra_attrs->>'tsid' AS tsid"
		tableStr             = "FROM " + storage.T_StructuralBlobs
		joinIDStr            = "JOIN " + storage.Blobs.String() + " ON " + storage.BlobsID.String() + "=" + storage.StructuralBlobsID.String()
		joinpkStr            = "JOIN " + storage.PublicKeys.String() + " ON " + storage.StructuralBlobsAuthor.String() + "=" + storage.PublicKeysID.String()
		joinLinksStr         = "LEFT JOIN " + storage.ResourceLinks.String() + " ON " + storage.StructuralBlobsID.String() + "=" + storage.ResourceLinksSource.String()
		leftjoinResourcesStr = "LEFT JOIN " + storage.Resources.String() + " ON " + storage.StructuralBlobsResource.String() + "=" + storage.ResourcesID.String()

		pageTokenStr = storage.BlobsID.String() + " <= :idx AND (" + storage.StructuralBlobsType.String() + " NOT IN ('Contact', 'Change')) AND " + storage.BlobsSize.String() + ">0 ORDER BY " + storage.BlobsID.String() + " desc limit :page_size"
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
		WHERE %s %s %s;
	`, selectStr, tableStr, joinIDStr, joinpkStr, joinLinksStr, leftjoinResourcesStr, filtersStr, linksStr, pageTokenStr)
	var lastBlobID int64
	conn, cancel, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()
	err = sqlitex.Exec(conn, dqb.Str(getEventsStr)(), func(stmt *sqlite.Stmt) error {
		lastBlobID = stmt.ColumnInt64(0)
		eventType := stmt.ColumnText(1)
		author := stmt.ColumnBytes(2)
		resource := stmt.ColumnText(3)
		eventTime := stmt.ColumnInt64(4) * 1000 //Its in microseconds and we need nanos
		observeTime := stmt.ColumnInt64(5)
		mhash := stmt.ColumnBytes(6)
		codec := stmt.ColumnInt64(7)
		tsid := stmt.ColumnText(8)
		accountID := core.Principal(author).String()
		id := cid.NewCidV1(uint64(codec), mhash)
		if eventType == "Comment" {
			resource = "hm://" + accountID + "/" + tsid
		}
		event := activity.Event{
			Data: &activity.Event_NewBlob{NewBlob: &activity.NewBlobEvent{
				Cid:      id.String(),
				BlobType: eventType,
				Author:   accountID,
				Resource: resource,
			}},
			Account:     accountID,
			EventTime:   &timestamppb.Timestamp{Seconds: eventTime / 1000000000, Nanos: int32(eventTime % 1000000000)}, //nolint:gosec
			ObserveTime: &timestamppb.Timestamp{Seconds: observeTime},
		}
		events = append(events, &event)
		return nil
	}, cursorBlobID, req.PageSize)
	if err != nil {
		return nil, fmt.Errorf("Problem collecting activity feed, Probably no feed or token out of range: %w", err)
	}

	var nextPageToken string
	if lastBlobID != 0 && int(req.PageSize) == len(events) {
		nextPageToken, err = apiutil.EncodePageToken(lastBlobID-1, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to encode next page token: %w", err)
		}
	}

	return &activity.ListEventsResponse{
		Events:        events,
		NextPageToken: nextPageToken,
	}, err
}
