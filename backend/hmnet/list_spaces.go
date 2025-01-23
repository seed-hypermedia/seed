package hmnet

import (
	"context"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/util/apiutil"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (srv *rpcMux) ListSpaces(ctx context.Context, in *p2p.ListSpacesRequest) (*p2p.ListSpacesResponse, error) {
	conn, release, err := srv.Node.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	var pageToken struct {
		ID int64
	}

	if in.PageSize == 0 {
		in.PageSize = 100
	}

	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &pageToken, srv.Node.device); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to decode page token: %v", err)
		}
	}

	out := &p2p.ListSpacesResponse{}

	var count int32
	if err := sqlitex.Exec(conn, qListSpaces(), func(stmt *sqlite.Stmt) error {
		if count == in.PageSize {
			out.HasMoreResults = true
			return nil
		}

		var (
			id    = stmt.ColumnInt64(0)
			space = stmt.ColumnText(1)
		)

		out.Spaces = append(out.Spaces, space)
		pageToken.ID = id
		return nil
	}, pageToken.ID, in.PageSize); err != nil {
		return nil, err
	}

	out.NextPageToken, err = apiutil.EncodePageToken(pageToken, srv.Node.device)
	if err != nil {
		return nil, err
	}

	return out, nil
}

var qListSpaces = dqb.Str(`
	SELECT
		id,
		REPLACE(iri, 'hm://', '') AS space_id
	FROM resources
	WHERE iri NOT GLOB 'hm://*/*'
	AND id > :page_token
	ORDER BY id
	LIMIT :page_size+1;
`)
