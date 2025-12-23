package activity

import (
	"context"
	"seed/backend/blob"
	"seed/backend/core"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/hmnet/syncing"
	"seed/backend/util/apiutil"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"strings"

	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Subscribe subscribes to a document.
func (srv *Server) Subscribe(ctx context.Context, req *activity.SubscribeRequest) (*emptypb.Empty, error) {
	_, ok := ctx.Deadline()
	if !ok {
		srv.log.Debug("Inserting deadline", zap.String("Duration", syncing.DefaultDiscoveryTimeout.String()))
		toCtx, cancelCtx := context.WithTimeout(ctx, syncing.DefaultDiscoveryTimeout)
		defer cancelCtx()
		ctx = toCtx
	}

	acc, err := core.DecodePrincipal(req.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Invalid account: %v", err)
	}

	wantedIRI, err := blob.NewIRI(acc, req.Path)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Invalid path: %v", err)
	}

	var async bool
	if req.Async != nil {
		async = *req.Async
	} else {
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, qGetResource(), func(stmt *sqlite.Stmt) error {
				async = true
				return nil
			}, wantedIRI)
		}); err != nil {
			return nil, err
		}
	}

	srv.log.Debug("Subscribe called", zap.Bool("async", async))

	// Delegate to syncing.Service which handles both DB and scheduler.
	if srv.sync == nil {
		return nil, status.Error(codes.Unavailable, "syncing service not available")
	}
	if err := srv.sync.Subscribe(ctx, wantedIRI, req.Recursive); err != nil {
		return nil, err
	}

	// Trigger discovery.
	if async {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), syncing.DefaultDiscoveryTimeout)
			defer cancel()
			_, err := srv.sync.DiscoverObject(ctx, wantedIRI, "", req.Recursive)
			if err != nil {
				srv.log.Debug("Non blocking Sync failed", zap.Error(err))
			}
		}()
	} else {
		// We ignore the error here because discovering the object during subscribing is a best-effort operation.
		_, _ = srv.sync.DiscoverObject(ctx, wantedIRI, "", req.Recursive)
	}

	return &emptypb.Empty{}, nil
}

// Unsubscribe removes a subscription.
func (srv *Server) Unsubscribe(ctx context.Context, req *activity.UnsubscribeRequest) (*emptypb.Empty, error) {
	acc, err := core.DecodePrincipal(req.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Invalid account: %v", err)
	}

	iri, err := blob.NewIRI(acc, req.Path)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Invalid path: %v", err)
	}

	// Delegate to syncing.Service which handles both DB and scheduler.
	if srv.sync == nil {
		return nil, status.Error(codes.Unavailable, "syncing service not available")
	}
	if err := srv.sync.Unsubscribe(ctx, iri); err != nil {
		return nil, err
	}

	return &emptypb.Empty{}, nil
}

// ListSubscriptions list all the active subscriptions.
func (srv *Server) ListSubscriptions(ctx context.Context, req *activity.ListSubscriptionsRequest) (*activity.ListSubscriptionsResponse, error) {
	if srv.sync == nil {
		return &activity.ListSubscriptionsResponse{}, nil
	}
	subs, err := srv.sync.ListSubscriptions(ctx)
	if err != nil {
		return nil, err
	}

	// Handle pagination in the API layer.
	cursorID := int64(len(subs))
	if req.PageToken != "" {
		if err := apiutil.DecodePageToken(req.PageToken, &cursorID, nil); err != nil {
			return nil, err
		}
	}

	if req.PageSize <= 0 {
		req.PageSize = 30
	}

	// Subscriptions are already sorted by ID DESC.
	var subscriptions []*activity.Subscription
	startIdx := int64(len(subs)) - cursorID
	if startIdx < 0 {
		startIdx = 0
	}
	endIdx := startIdx + int64(req.PageSize)
	if endIdx > int64(len(subs)) {
		endIdx = int64(len(subs))
	}

	for i := startIdx; i < endIdx; i++ {
		sub := subs[i]
		iriStr := strings.TrimPrefix(string(sub.IRI), "hm://")
		accPath := strings.SplitN(iriStr, "/", 2)
		acc := accPath[0]
		path := ""
		if len(accPath) > 1 {
			path = "/" + accPath[1]
		}
		subscriptions = append(subscriptions, &activity.Subscription{
			Account:   acc,
			Path:      path,
			Recursive: sub.Recursive,
			Since:     timestamppb.New(sub.Since),
		})
	}

	var nextPageToken string
	if endIdx < int64(len(subs)) {
		nextPageToken = apiutil.EncodePageToken(cursorID-int64(req.PageSize), nil)
	}

	return &activity.ListSubscriptionsResponse{
		Subscriptions: subscriptions,
		NextPageToken: nextPageToken,
	}, nil
}

var qGetResource = dqb.Str(`
	SELECT
		iri
	FROM resources
	WHERE iri = :wanted_iri LIMIT 1;
`)
