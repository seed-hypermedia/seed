package documents

import (
	"context"
	"encoding/json"
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
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
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

	if err := srv.checkWriteAccess(ctx, account, "", kp); err != nil {
		return nil, err
	}

	clock := cclock.New()

	eb, err := blob.NewContact(kp, "", account, subject, in.Name, nil, clock.MustNow())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create contact: %v", err)
	}

	if err := srv.idx.Put(ctx, eb); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store contact: %v", err)
	}

	return contactToProto(eb.TSID(), eb.Decoded), nil
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
				latest_sb.id,
				pk_account.principal as account_principal,
				pk_signer.principal as signer_principal,
				pk_subject.principal as subject_principal,
				latest_sb.extra_attrs->>'name' as name,
				latest_sb.extra_attrs->>'tsid' as tsid,
				latest_sb.extra_attrs->>'deleted' as deleted,
				latest_sb.ts,
				latest_sb.extra_attrs->'subscribe' as subscribe
			FROM (
				SELECT
					sb.*,
					COALESCE(res.owner, sb.author) as account_id,
					ROW_NUMBER() OVER (
						PARTITION BY sb.extra_attrs->>'tsid', COALESCE(res.owner, sb.author)
						ORDER BY sb.ts DESC
					) as rn
				FROM structural_blobs sb
				LEFT JOIN resources res ON res.id = sb.resource
				WHERE sb.type = 'Contact'
				AND COALESCE(res.owner, sb.author) = (SELECT id FROM public_keys WHERE principal = ?)
			) latest_sb
			JOIN public_keys pk_account ON pk_account.id = latest_sb.account_id
			JOIN public_keys pk_signer ON pk_signer.id = latest_sb.author
			LEFT JOIN public_keys pk_subject ON pk_subject.id = latest_sb.extra_attrs->>'subject'
			WHERE latest_sb.rn = 1
			AND latest_sb.extra_attrs->>'deleted' IS NULL
			AND latest_sb.id < ?
			ORDER BY latest_sb.id DESC
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
				latest_sb.id,
				pk_account.principal as account_principal,
				pk_signer.principal as signer_principal,
				pk_subject.principal as subject_principal,
				latest_sb.extra_attrs->>'name' as name,
				latest_sb.extra_attrs->>'tsid' as tsid,
				latest_sb.extra_attrs->>'deleted' as deleted,
				latest_sb.ts,
				latest_sb.extra_attrs->'subscribe' as subscribe
			FROM (
				SELECT
					sb.*,
					COALESCE(res.owner, sb.author) as account_id,
					ROW_NUMBER() OVER (
						PARTITION BY sb.extra_attrs->>'tsid', COALESCE(res.owner, sb.author)
						ORDER BY sb.ts DESC
					) as rn
				FROM structural_blobs sb
				LEFT JOIN resources res ON res.id = sb.resource
				WHERE sb.type = 'Contact'
				AND sb.extra_attrs->>'subject' = (SELECT id FROM public_keys WHERE principal = ?)
			) latest_sb
			JOIN public_keys pk_account ON pk_account.id = latest_sb.account_id
			JOIN public_keys pk_signer ON pk_signer.id = latest_sb.author
			LEFT JOIN public_keys pk_subject ON pk_subject.id = latest_sb.extra_attrs->>'subject'
			WHERE latest_sb.rn = 1
			AND latest_sb.extra_attrs->>'deleted' IS NULL
			AND latest_sb.id < ?
			ORDER BY latest_sb.id DESC
			LIMIT ?
		`
		args = []any{subjectPrincipal, cursor.ContactID, in.PageSize + 1}
	}

	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) (err error) {
		rows, discard, check := sqlitex.Query(conn, query, args...).All()
		defer discard(&err)

		for row := range rows {
			if len(out.Contacts) == int(in.PageSize) {
				out.NextPageToken = apiutil.EncodePageToken(cursor, nil)
				break
			}

			seq := sqlite.NewIncrementor(0)
			id := row.ColumnInt64(seq())
			accountPrincipal := row.ColumnBytes(seq())
			signerPrincipal := row.ColumnBytes(seq())
			subjectPrincipal := row.ColumnBytes(seq())
			name := row.ColumnText(seq())
			tsid := row.ColumnText(seq())
			deleted := row.ColumnText(seq())
			ts := row.ColumnInt64(seq())
			subscribeJSON := row.ColumnText(seq())

			// Skip deleted contacts (should already be filtered by query, but double-check).
			if deleted == "true" {
				continue
			}

			timestamp := time.UnixMilli(ts)

			// Create time is inferred from the original TSID.
			createTimestamp := blob.TSID(tsid).Timestamp()

			rid := blob.RecordID{Authority: accountPrincipal, TSID: blob.TSID(tsid)}

			proto := &documents.Contact{
				Id:         rid.String(),
				Subject:    core.Principal(subjectPrincipal).String(),
				Name:       name,
				CreateTime: timestamppb.New(createTimestamp),
				UpdateTime: timestamppb.New(timestamp),
				Account:    core.Principal(accountPrincipal).String(),
				Signer:     core.Principal(signerPrincipal).String(),
			}

			// Build metadata struct with subscribe preferences if present.
			if subscribeJSON != "" {
				var subscribeData map[string]any
				if err := json.Unmarshal([]byte(subscribeJSON), &subscribeData); err == nil && len(subscribeData) > 0 {
					metadata := map[string]any{
						"subscribe": subscribeData,
					}
					if metadataStruct, err := structpb.NewStruct(metadata); err == nil {
						proto.Metadata = metadataStruct
					}
				}
			}

			cursor.ContactID = id

			out.Contacts = append(out.Contacts, proto)
		}

		return check()
	}); err != nil {
		return nil, err
	}

	return out, nil
}

// GetContact implements Documents API v3.
func (srv *Server) GetContact(ctx context.Context, in *documents.GetContactRequest) (out *documents.Contact, err error) {
	if in.Id == "" {
		return nil, status.Errorf(codes.InvalidArgument, "id is required")
	}

	recordID, err := blob.DecodeRecordID(in.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode contact ID: %v", err)
	}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	query := `
		SELECT
			pk_account.principal as account_principal,
			pk_signer.principal as signer_principal,
			pk_subject.principal as subject_principal,
			sb.extra_attrs->>'name' as name,
			sb.extra_attrs->>'deleted' as deleted,
			sb.ts,
			sb.extra_attrs->'subscribe' as subscribe
		FROM structural_blobs sb
		LEFT JOIN resources res ON res.id = sb.resource
		JOIN public_keys pk_account ON pk_account.id = COALESCE(res.owner, sb.author)
		JOIN public_keys pk_signer ON pk_signer.id = sb.author
		LEFT JOIN public_keys pk_subject ON pk_subject.id = sb.extra_attrs->>'subject'
		WHERE sb.type = 'Contact'
		AND sb.resource = (
			SELECT id FROM resources WHERE iri = 'hm://' || ?
		)
		AND sb.extra_attrs->>'tsid' = ?
		ORDER BY sb.ts DESC
		LIMIT 1
	`

	var contact *documents.Contact
	rows, discard, check := sqlitex.Query(conn, query, recordID.Authority.String(), recordID.TSID.String()).All()
	defer discard(&err)
	for row := range rows {
		seq := sqlite.NewIncrementor(0)
		accountPrincipal := row.ColumnBytes(seq())
		signerPrincipal := row.ColumnBytes(seq())
		subjectPrincipal := row.ColumnBytes(seq())
		name := row.ColumnText(seq())
		deleted := row.ColumnText(seq())
		ts := row.ColumnInt64(seq())
		subscribeJSON := row.ColumnText(seq())

		// If this is a tombstone (deleted contact), return not found
		if deleted != "" {
			return nil, status.Errorf(codes.NotFound, "contact not found")
		}

		timestamp := time.UnixMilli(ts)

		// Create time is inferred from the original TSID
		createTimestamp := recordID.TSID.Timestamp()

		contact = &documents.Contact{
			Id:         in.Id,
			Subject:    core.Principal(subjectPrincipal).String(),
			Name:       name,
			CreateTime: timestamppb.New(createTimestamp),
			UpdateTime: timestamppb.New(timestamp),
			Account:    core.Principal(accountPrincipal).String(),
			Signer:     core.Principal(signerPrincipal).String(),
		}

		// Build metadata struct with subscribe preferences if present.
		if subscribeJSON != "" {
			var subscribeData map[string]any
			if err := json.Unmarshal([]byte(subscribeJSON), &subscribeData); err == nil && len(subscribeData) > 0 {
				metadata := map[string]any{
					"subscribe": subscribeData,
				}
				if metadataStruct, err := structpb.NewStruct(metadata); err == nil {
					contact.Metadata = metadataStruct
				}
			}
		}
		break
	}
	if err := check(); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to query contact: %v", err)
	}

	return contact, nil
}

// UpdateContact implements Documents API v3.
func (srv *Server) UpdateContact(ctx context.Context, in *documents.UpdateContactRequest) (*documents.Contact, error) {
	if err := validation.ValidateStruct(in,
		validation.Field(&in.Contact, validation.Required),
		validation.Field(&in.SigningKeyName, validation.Required),
	); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}

	contact := in.Contact
	if err := validation.ValidateStruct(contact,
		validation.Field(&contact.Id, validation.Required),
		validation.Field(&contact.Account, validation.Required),
		validation.Field(&contact.Subject, validation.Required),
		validation.Field(&contact.Name, validation.Required),
	); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}

	account, err := core.DecodePrincipal(contact.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode account: %v", err)
	}

	subject, err := core.DecodePrincipal(contact.Subject)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode subject: %v", err)
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	// Extract TSID from RecordID format
	recordID, err := blob.DecodeRecordID(contact.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode contact ID: %v", err)
	}

	if !recordID.Authority.Equal(account) {
		return nil, status.Errorf(codes.InvalidArgument, "contact account must match contact ID authority")
	}

	if err := srv.checkWriteAccess(ctx, account, "", kp); err != nil {
		return nil, err
	}

	clock := cclock.New()

	encoded, err := blob.NewContact(kp, recordID.TSID, account, subject, contact.Name, nil, clock.MustNow())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update contact: %v", err)
	}

	if err := srv.idx.Put(ctx, encoded); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store contact update: %v", err)
	}

	return contactToProto(encoded.TSID(), encoded.Decoded), nil
}

// DeleteContact implements Documents API v3.
func (srv *Server) DeleteContact(ctx context.Context, in *documents.DeleteContactRequest) (*emptypb.Empty, error) {
	if err := validation.ValidateStruct(in,
		validation.Field(&in.Id, validation.Required),
		validation.Field(&in.SigningKeyName, validation.Required),
	); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "%v", err)
	}

	recordID, err := blob.DecodeRecordID(in.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode contact ID: %v", err)
	}

	account := recordID.Authority

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	if err := srv.checkWriteAccess(ctx, account, "", kp); err != nil {
		return nil, err
	}

	clock := cclock.New()

	encoded, err := blob.NewContact(kp, recordID.TSID, account, nil, "", nil, clock.MustNow())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete contact: %v", err)
	}

	if err := srv.idx.Put(ctx, encoded); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store contact deletion: %v", err)
	}

	return &emptypb.Empty{}, nil
}

func contactToProto(tsid blob.TSID, v *blob.Contact) *documents.Contact {
	account := v.AccountPrincipal()
	rid := blob.RecordID{
		Authority: account,
		TSID:      tsid,
	}
	createTime := tsid.Timestamp()

	proto := &documents.Contact{
		Id:         rid.String(),
		Subject:    core.Principal(v.Subject).String(),
		Name:       v.Name,
		CreateTime: timestamppb.New(createTime),
		UpdateTime: timestamppb.New(v.Ts),
		Account:    core.Principal(account).String(),
		Signer:     core.Principal(v.Signer).String(),
	}

	// Add subscribe preferences to metadata if present.
	if v.Subscribe != nil {
		subscribeData := map[string]any{}
		if v.Subscribe.Site {
			subscribeData["site"] = true
		}
		if v.Subscribe.Profile {
			subscribeData["profile"] = true
		}
		if len(subscribeData) > 0 {
			metadata := map[string]any{
				"subscribe": subscribeData,
			}
			if metadataStruct, err := structpb.NewStruct(metadata); err == nil {
				proto.Metadata = metadataStruct
			}
		}
	}

	return proto
}
