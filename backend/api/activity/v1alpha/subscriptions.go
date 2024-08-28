package activity

import (
	"context"
	"fmt"
	"math"
	activity "seed/backend/genproto/activity/v1alpha"
	"seed/backend/util/apiutil"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/sqlitegen"

	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Subscribe subscribes to a document.
func (srv *Server) Subscribe(ctx context.Context, req *activity.SubscribeRequest) (*emptypb.Empty, error) {
	vals := []interface{}{}
	conn, cancel, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer cancel()
	sqlStr := "INSERT INTO subscriptions (resource, is_recursive) VALUES (?,?)"

	vals = append(vals, req.Url, req.Recursive)
	if err := sqlitex.Exec(conn, sqlStr, nil, vals...); err != nil {
		return &emptypb.Empty{}, err
	}
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
		stmt.SetText(":id", req.Url)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
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

	var lastBlobID int64
	err = sqlitex.Exec(conn, qListSubscriptions(), func(stmt *sqlite.Stmt) error {
		lastBlobID = stmt.ColumnInt64(0)
		resource := stmt.ColumnText(1)
		recursive := stmt.ColumnInt(2)
		insertTime := stmt.ColumnInt64(3)
		item := activity.Subscription{
			Url:       resource,
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
	if lastBlobID != 0 && req.PageSize == int32(len(subscriptions)) {
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
		resource,
		is_recursive,
		insert_time
	FROM subscriptions
	WHERE id < :last_cursor
	ORDER BY id DESC LIMIT :page_size + 1;
`)
