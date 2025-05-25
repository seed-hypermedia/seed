package documents

import (
	"context"
	"errors"
	"math"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/apiutil"
	"seed/backend/util/cclock"
	"seed/backend/util/errutil"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"time"

	"github.com/invopop/validation"
	"github.com/ipfs/go-cid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateContact implements Documents API v3.
func (srv *Server) CreateContact(ctx context.Context, in *documents.CreateContactRequest) (*documents.Contact, error) {
	if err := validation.ValidateStruct(in,
		validation.Field(&in.Account, validation.Required),
		validation.Field(&in.SigningKeyName, validation.Required),
		validation.Field(&in.Subject, validation.Required),
		validation.Field(&in.Name, validation.Required),
	); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}

	account, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode account: %v", err)
	}

	subject, err := core.DecodePrincipal(in.Subject)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode subject: %v", err)
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	if !kp.Principal().Equal(account) {
		return nil, status.Errorf(codes.PermissionDenied, "delegated signing for contacts is not implemented yet: signing key must match the account issuing the contact")
	}

	clock := cclock.New()

	encoded, err := blob.NewContact(kp, cid.Undef, subject, in.Name, clock.MustNow())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create contact: %v", err)
	}

	if err := srv.idx.Put(ctx, encoded); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store contact: %v", err)
	}

	return &documents.Contact{
		Subject:    in.Subject,
		Name:       in.Name,
		CreateTime: timestamppb.New(encoded.Decoded.Ts),
		UpdateTime: timestamppb.New(encoded.Decoded.Ts),
		Account:    in.Account,
	}, nil
}

// ListContacts implements Documents API v3.
func (srv *Server) ListContacts(ctx context.Context, in *documents.ListContactsRequest) (*documents.ListContactsResponse, error) {
	if in.GetAccount() == "" && in.GetSubject() == "" {
		return nil, errutil.MissingArgument("filter (account or subject)")
	}

	if in.PageSize == 0 {
		in.PageSize = defaultPageSize
	}

	var cursor struct {
		ContactID int64 `json:"c_id"`
	}

	cursor.ContactID = math.MaxInt64

	if in.PageToken != "" {
		if err := apiutil.DecodePageToken(in.PageToken, &cursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}

	out := &documents.ListContactsResponse{
		Contacts: make([]*documents.Contact, 0, min(in.PageSize, maxPageAllocBuffer)),
	}

	var query string
	var args []any

	if account := in.GetAccount(); account != "" {
		accountPrincipal, err := core.DecodePrincipal(account)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid account: %v", err)
		}

		query = `
			SELECT
				sb.id,
				pk_author.principal as account_principal,
				pk_subject.principal as subject_principal,
				sb.extra_attrs->>'name' as name,
				sb.ts
			FROM structural_blobs sb
			JOIN public_keys pk_author ON pk_author.id = sb.author
			JOIN public_keys pk_subject ON pk_subject.id = sb.extra_attrs->>'subject'
			WHERE sb.type = 'Contact'
			AND pk_author.principal = ?
			AND sb.id < ?
			ORDER BY sb.id DESC
			LIMIT ?
		`
		args = []any{accountPrincipal, cursor.ContactID, in.PageSize + 1}
	} else {
		subjectPrincipal, err := core.DecodePrincipal(in.GetSubject())
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid subject: %v", err)
		}

		query = `
			SELECT
				sb.id,
				pk_author.principal as account_principal,
				pk_subject.principal as subject_principal,
				sb.extra_attrs->>'name' as name,
				sb.ts
			FROM structural_blobs sb
			JOIN public_keys pk_author ON pk_author.id = sb.author
			JOIN public_keys pk_subject ON pk_subject.id = sb.extra_attrs->>'subject'
			WHERE sb.type = 'Contact'
			AND pk_subject.principal = ?
			AND sb.id < ?
			ORDER BY sb.id DESC
			LIMIT ?
		`
		args = []any{subjectPrincipal, cursor.ContactID, in.PageSize + 1}
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	var count int32
	rows, check := sqlitex.Query(conn, query, args...)
	for row := range rows {
		if count == in.PageSize {
			out.NextPageToken, err = apiutil.EncodePageToken(cursor, nil)
			break
		}

		seq := sqlite.NewIncrementor(0)
		id := row.ColumnInt64(seq())
		accountPrincipal := row.ColumnBytes(seq())
		subjectPrincipal := row.ColumnBytes(seq())
		name := row.ColumnText(seq())
		ts := row.ColumnInt64(seq())

		timestamp := time.UnixMilli(ts)

		proto := &documents.Contact{
			Subject:    core.Principal(subjectPrincipal).String(),
			Name:       name,
			CreateTime: timestamppb.New(timestamp),
			UpdateTime: timestamppb.New(timestamp),
			Account:    core.Principal(accountPrincipal).String(),
		}

		cursor.ContactID = id

		out.Contacts = append(out.Contacts, proto)
		count++
	}

	err = errors.Join(err, check())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to query contacts: %v", err)
	}

	return out, nil
}
