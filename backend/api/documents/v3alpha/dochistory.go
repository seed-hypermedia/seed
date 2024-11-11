package documents

import (
	"context"
	"maps"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/apiutil"
	"seed/backend/util/colx"
	"seed/backend/util/errutil"
	"slices"

	"github.com/ipfs/go-cid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ListDocumentChanges implements Documents API v3.
func (srv *Server) ListDocumentChanges(ctx context.Context, in *documents.ListDocumentChangesRequest) (*documents.ListDocumentChangesResponse, error) {
	const (
		defaultPageSize = 20
		maxPageSize     = 10000
	)

	var (
		acc core.Principal
		err error
	)
	{
		acc, err = core.DecodePrincipal(in.Account)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to parse account '%s': %v", in.Account, err)
		}

		if in.Version == "" {
			return nil, errutil.MissingArgument("version")
		}

		if in.PageSize == 0 {
			in.PageSize = defaultPageSize
		}

		if in.PageSize > maxPageSize {
			in.PageSize = maxPageSize
		}
	}

	heads, err := docmodel.Version(in.Version).Parse()
	if err != nil {
		return nil, err
	}

	// TODO(burdiyan): This is the most stupid way to get the history of the document.
	// We need to just use the database index, but it's currently too painful to work with,
	// because we don't track latest heads for each space+path.

	doc, err := srv.loadDocument(ctx, acc, in.Path, heads, false)
	if err != nil {
		return nil, err
	}

	var cursor struct {
		StartFrom string
	}
	if in.PageToken != "" {
		apiutil.DecodePageToken(in.PageToken, &cursor, nil)
	}

	out := &documents.ListDocumentChangesResponse{
		Changes: make([]*documents.DocumentChangeInfo, 0, in.PageSize),
	}

	changes, err := doc.BFTDeps(slices.Collect(maps.Keys(doc.Heads())))
	if err != nil {
		return nil, err
	}

	var foundCursor bool
	if in.PageToken == "" {
		foundCursor = true
	}
	var nextCursor string
	for c, change := range changes {
		cc := c.String()
		if !foundCursor {
			if cc == cursor.StartFrom {
				foundCursor = true
			} else {
				continue
			}
		}

		if len(out.Changes) == int(in.PageSize) {
			nextCursor = cc
			break
		}
		out.Changes = append(out.Changes, &documents.DocumentChangeInfo{
			Id:         cc,
			Author:     change.Signer.String(),
			Deps:       colx.SliceMap(change.Deps, cid.Cid.String),
			CreateTime: timestamppb.New(change.Ts),
		})
	}

	if nextCursor != "" {
		cursor.StartFrom = nextCursor
		out.NextPageToken, err = apiutil.EncodePageToken(cursor, nil)
		if err != nil {
			return nil, err
		}
	}

	return out, err
}
