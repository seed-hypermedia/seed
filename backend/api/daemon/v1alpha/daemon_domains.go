package daemon

import (
	context "context"
	"seed/backend/blob"

	daemon "seed/backend/genproto/daemon/v1alpha"

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
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "domain not found: %s", req.Domain)
	}

	return domainEntryToProto(entry), nil
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
		return nil, err
	}

	return domainEntryToProto(entry), nil
}

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
