package daemon

import (
	context "context"
	"net/url"
	"seed/backend/blob"
	daemon "seed/backend/genproto/daemon/v1alpha"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
	emptypb "google.golang.org/protobuf/types/known/emptypb"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
)

// GetDomain returns cached information about a tracked domain.
func (srv *Server) GetDomain(ctx context.Context, req *daemon.GetDomainRequest) (*daemon.DomainInfo, error) {
	if req.Domain == "" {
		return nil, status.Error(codes.InvalidArgument, "domain is required")
	}

	entry, err := srv.domains.GetDomain(ctx, req.Domain)
	if err == nil {
		if entry.LastConfig != nil && entry.LastConfig.RegisteredAccountUID != "" {
			return domainEntryToProto(entry), nil
		}
		fallbackEntry, ok, lookupErr := srv.lookupLocalDomainAccount(ctx, req.Domain)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if ok {
			return domainEntryToProto(fallbackEntry), nil
		}
		return domainEntryToProto(entry), nil
	}

	entry, ok, lookupErr := srv.lookupLocalDomainAccount(ctx, req.Domain)
	if lookupErr != nil {
		return nil, lookupErr
	}
	if ok {
		return domainEntryToProto(entry), nil
	}

	return nil, status.Errorf(codes.NotFound, "domain not found: %s", req.Domain)
}

// ListDomains returns all tracked domains.
func (srv *Server) ListDomains(ctx context.Context, _ *daemon.ListDomainsRequest) (*daemon.ListDomainsResponse, error) {
	entries, err := srv.domains.ListDomains(ctx)
	if err != nil {
		return nil, err
	}

	resp := &daemon.ListDomainsResponse{
		Domains: make([]*daemon.DomainInfo, len(entries)),
	}
	for i, e := range entries {
		resp.Domains[i] = domainEntryToProto(e)
	}
	return resp, nil
}

// AddDomain adds a domain to be tracked and triggers an initial check.
func (srv *Server) AddDomain(ctx context.Context, req *daemon.AddDomainRequest) (*daemon.DomainInfo, error) {
	if req.Domain == "" {
		return nil, status.Error(codes.InvalidArgument, "domain is required")
	}

	if err := srv.domains.PutDomain(ctx, req.Domain); err != nil {
		return nil, err
	}

	// Trigger an initial check.
	entry, err := srv.domains.CheckDomain(ctx, req.Domain)
	if err != nil {
		return nil, err
	}

	return domainEntryToProto(entry), nil
}

// RemoveDomain stops tracking a domain.
func (srv *Server) RemoveDomain(ctx context.Context, req *daemon.RemoveDomainRequest) (*emptypb.Empty, error) {
	if req.Domain == "" {
		return nil, status.Error(codes.InvalidArgument, "domain is required")
	}

	if err := srv.domains.RemoveDomain(ctx, req.Domain); err != nil {
		return nil, err
	}

	return &emptypb.Empty{}, nil
}

// CheckDomain forces a re-check of a domain's /hm/api/config endpoint.
func (srv *Server) CheckDomain(ctx context.Context, req *daemon.CheckDomainRequest) (*daemon.DomainInfo, error) {
	if req.Domain == "" {
		return nil, status.Error(codes.InvalidArgument, "domain is required")
	}

	entry, err := srv.domains.CheckDomain(ctx, req.Domain)
	if err != nil {
		fallbackEntry, ok, lookupErr := srv.lookupLocalDomainAccount(ctx, req.Domain)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if ok {
			return domainEntryToProto(fallbackEntry), nil
		}
		return nil, err
	}
	if entry.LastConfig == nil || entry.LastConfig.RegisteredAccountUID == "" {
		fallbackEntry, ok, lookupErr := srv.lookupLocalDomainAccount(ctx, req.Domain)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if ok {
			return domainEntryToProto(fallbackEntry), nil
		}
	}

	return domainEntryToProto(entry), nil
}

func (srv *Server) lookupLocalDomainAccount(ctx context.Context, domain string) (blob.DomainEntry, bool, error) {
	var entry blob.DomainEntry
	entry.Domain = domain

	err := srv.store.DB().WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qLookupLocalDomainAccount(), func(stmt *sqlite.Stmt) error {
			siteURL := stmt.ColumnText(1)
			if siteURL == "" {
				return nil
			}
			parsed, err := url.Parse(siteURL)
			if err != nil || parsed.Hostname() != domain {
				return nil
			}
			entry.LastStatus = "success"
			entry.LastConfig = &blob.SiteConfigResponse{RegisteredAccountUID: stmt.ColumnText(0)}
			return nil
		})
	})
	if err != nil {
		return blob.DomainEntry{}, false, status.Errorf(codes.Internal, "failed to inspect local site metadata: %v", err)
	}
	if entry.LastConfig == nil || entry.LastConfig.RegisteredAccountUID == "" {
		return blob.DomainEntry{}, false, nil
	}
	return entry, true, nil
}

var qLookupLocalDomainAccount = dqb.Str(`
	SELECT substr(r.iri, 6) AS account_uid, COALESCE(dg.metadata->>'$.siteUrl.v', '') AS site_url
	FROM document_generations dg
	JOIN resources r ON r.id = dg.resource
	WHERE instr(r.iri, 'hm://') = 1
		AND instr(substr(r.iri, 6), '/') = 0
		AND dg.generation = (
			SELECT MAX(dg2.generation)
			FROM document_generations dg2
			WHERE dg2.resource = dg.resource
		)
`)

func domainEntryToProto(e blob.DomainEntry) *daemon.DomainInfo {
	info := &daemon.DomainInfo{
		Domain:    e.Domain,
		Status:    e.LastStatus,
		LastError: e.LastError,
	}

	if !e.LastCheck.IsZero() {
		info.LastCheck = timestamppb.New(e.LastCheck)
	}
	if !e.LastSuccess.IsZero() {
		info.LastSuccess = timestamppb.New(e.LastSuccess)
	}
	if e.LastConfig != nil {
		info.RegisteredAccountUid = e.LastConfig.RegisteredAccountUID
		info.PeerId = e.LastConfig.PeerID
	}

	return info
}
