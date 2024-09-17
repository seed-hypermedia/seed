package activity

import (
	"context"
	"fmt"
	"math"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/syncing"
	"seed/backend/util/apiutil"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/sqlitegen"
	"strings"

	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Subscribe subscribes to a document.
func (srv *Server) Subscribe(ctx context.Context, req *activity.SubscribeRequest) (*emptypb.Empty, error) {
	vals := []interface{}{}

	_, ok := ctx.Deadline()
	if !ok {
		srv.log.Debug("Inserting deadline", zap.String("Duration", syncing.DefaultDiscoveryTimeout.String()))
		toCtx, cancelCtx := context.WithTimeout(ctx, syncing.DefaultDiscoveryTimeout)
		defer cancelCtx()
		ctx = toCtx
	}
	conn, cancel, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}

	// If the document is not present locally, then we make this call blocking,
	// since we have to discover it first.
	var blocking = true
	wantedIri := "hm://" + req.Account + req.Path
	err = sqlitex.Exec(conn, qGetResource(), func(stmt *sqlite.Stmt) error {
		iri := stmt.ColumnText(0)
		if wantedIri != iri {
			return fmt.Errorf("wantedIri [%s] does not match returned iri [%s]", wantedIri, iri)
		}
		blocking = false
		return nil
	}, wantedIri)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("Problem collecting subscriptions, Probably no subscriptions or token out of range: %w", err)
	}
	srv.log.Debug("Subscribe called", zap.Bool("Blocking", blocking))

	if srv.syncer == nil && blocking {
		cancel()
		return nil, fmt.Errorf("Syncer non defined on blocking call")
	}

	sqlStr := "INSERT OR REPLACE INTO subscriptions (iri, is_recursive) VALUES (?,?)"
	vals = append(vals, "hm://"+req.Account+req.Path, req.Recursive)
	if err := sqlitex.Exec(conn, sqlStr, nil, vals...); err != nil {
		cancel()
		return &emptypb.Empty{}, err
	}
	cancel()
	subscriptionReq := activity.Subscription{
		Account:   req.Account,
		Path:      req.Path,
		Recursive: req.Recursive,
	}
	if blocking {
		ret, err := srv.syncer.SyncSubscribedContent(ctx, &subscriptionReq)
		if err != nil {
			srv.log.Debug("Blocking Sync failed", zap.Error(err))
			return &emptypb.Empty{}, err
		}
		if ret.NumSyncOK == 0 {
			const errMsg = "Could not sync subscribed content from any known peer"
			srv.log.Debug(errMsg)
			return &emptypb.Empty{}, fmt.Errorf("%s", errMsg)
		}
	}
	go func() {
		syncCtx, cancel := context.WithTimeout(context.Background(), syncing.DefaultDiscoveryTimeout)
		_, err := srv.syncer.SyncSubscribedContent(syncCtx, &subscriptionReq)
		if err != nil {
			srv.log.Debug("Non blocking Sync failed", zap.Error(err))
		}
		cancel()
	}()
	return &emptypb.Empty{}, nil
}

// Unsubscribe removes a subscription.
func (srv *Server) Unsubscribe(ctx context.Context, req *activity.UnsubscribeRequest) (*emptypb.Empty, error) {
	conn, cancel, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	const query = `DELETE FROM subscriptions WHERE subscriptions.iri = :id`

	before := func(stmt *sqlite.Stmt) {
		stmt.SetText(":id", "hm://"+req.Account+req.Path)
	}

	onStep := func(_ int, _ *sqlite.Stmt) error {
		return nil
	}

	return &emptypb.Empty{}, sqlitegen.ExecStmt(conn, query, before, onStep)
}

// ListSubscriptions list all the active subscriptions.
func (srv *Server) ListSubscriptions(ctx context.Context, req *activity.ListSubscriptionsRequest) (*activity.ListSubscriptionsResponse, error) {
	var cursorID int64 = math.MaxInt32
	if req.PageToken != "" {
		if err := apiutil.DecodePageToken(req.PageToken, &cursorID, nil); err != nil {
			return nil, fmt.Errorf("failed to decode page token: %w", err)
		}
	}
	conn, cancel, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()

	var subscriptions []*activity.Subscription

	if req.PageSize <= 0 {
		req.PageSize = 30
	}
	var lastBlobID int64
	err = sqlitex.Exec(conn, qListSubscriptions(), func(stmt *sqlite.Stmt) error {
		lastBlobID = stmt.ColumnInt64(0)
		iri := strings.TrimPrefix(stmt.ColumnText(1), "hm://")
		recursive := stmt.ColumnInt(2)
		insertTime := stmt.ColumnInt64(3)
		acc := strings.Split(iri, "/")[0]
		item := activity.Subscription{
			Account:   acc,
			Path:      strings.TrimPrefix(iri, acc),
			Recursive: recursive != 0,
			Since:     &timestamppb.Timestamp{Seconds: insertTime},
		}

		subscriptions = append(subscriptions, &item)
		return nil
	}, cursorID, req.PageSize)
	if err != nil {
		return nil, fmt.Errorf("Problem collecting subscriptions, Probably no subscriptions or token out of range: %w", err)
	}

	var nextPageToken string
	if lastBlobID != 0 && int(req.PageSize) == len(subscriptions) {
		nextPageToken, err = apiutil.EncodePageToken(lastBlobID-1, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to encode next page token: %w", err)
		}
	}

	return &activity.ListSubscriptionsResponse{
		Subscriptions: subscriptions,
		NextPageToken: nextPageToken,
	}, err
}

var qListSubscriptions = dqb.Str(`
	SELECT 
		id,
		iri,
		is_recursive,
		insert_time
	FROM subscriptions
	WHERE id < :last_cursor
	ORDER BY id DESC LIMIT :page_size;
`)

var qGetResource = dqb.Str(`
	SELECT 
		iri
	FROM resources
	WHERE iri = :wanted_iri LIMIT 1;
`)
