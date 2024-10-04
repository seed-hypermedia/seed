package documents

import (
	"context"
	"fmt"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/blob"
	"seed/backend/util/errutil"
	"time"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateCapability implements Access Control API.
func (srv *Server) CreateCapability(ctx context.Context, in *documents.CreateCapabilityRequest) (*documents.Capability, error) {
	{
		if in.SigningKeyName == "" {
			return nil, errutil.MissingArgument("signing_key_name")
		}

		if in.Delegate == "" {
			return nil, errutil.MissingArgument("delegate")
		}

		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}

		if in.NoRecursive {
			return nil, status.Error(codes.Unimplemented, "TODO: no_recursive is not implemented yet")
		}
	}

	kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)
	if err != nil {
		return nil, err
	}

	acc, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, err
	}

	del, err := core.DecodePrincipal(in.Delegate)
	if err != nil {
		return nil, err
	}

	// TODO(burdiyan): Implement nested capability delegations when we have roles which allow that.
	if !acc.Equal(kp.Principal()) {
		return nil, status.Errorf(codes.PermissionDenied, "signing key %s cannot create capabilities for account %s", kp.Principal(), acc)
	}

	// TODO(burdiyan): Get rid of this IRI stuff probably, and just make it a validation function.
	// Still unsure whether we'll keep the idea of a resource and IRI in the database.
	if _, err := makeIRI(acc, in.Path); err != nil {
		return nil, err
	}

	// TODO(burdiyan): Validate role according to the chain of capabilities.
	role := in.Role.String()

	cpb, err := blob.NewCapability(kp, del, acc, in.Path, role, time.Now().UnixMicro(), in.NoRecursive)
	if err != nil {
		return nil, err
	}

	if err := srv.idx.Put(ctx, cpb); err != nil {
		return nil, err
	}

	return srv.GetCapability(ctx, &documents.GetCapabilityRequest{Id: cpb.CID.String()})
}

// GetCapability implements Access Control API.
func (srv *Server) GetCapability(ctx context.Context, in *documents.GetCapabilityRequest) (*documents.Capability, error) {
	c, err := cid.Decode(in.Id)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse capability ID %s as CID: %v", in.Id, err)
	}

	blk, err := srv.idx.Get(ctx, c)
	if err != nil {
		return nil, err
	}

	cpb := &blob.Capability{}
	if err := cbornode.DecodeInto(blk.RawData(), cpb); err != nil {
		return nil, err
	}

	return capToProto(blk.Cid(), cpb)
}

// ListCapabilities implements Access Control API.
func (srv *Server) ListCapabilities(ctx context.Context, in *documents.ListCapabilitiesRequest) (*documents.ListCapabilitiesResponse, error) {
	{
		if in.IgnoreInherited {
			return nil, status.Error(codes.Unimplemented, "TODO: ignore_inherited is not implemented yet, permissions are inherited by default")
		}

		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}
	}

	acc, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, err
	}

	iri, err := makeIRI(acc, in.Path)
	if err != nil {
		return nil, err
	}

	// TODO(burdiyan): implement pagination.
	resp := &documents.ListCapabilitiesResponse{}

	if err := srv.idx.WalkCapabilities(ctx, iri, acc, func(c cid.Cid, cpb *blob.Capability) error {
		pb, err := capToProto(c, cpb)
		if err != nil {
			return err
		}
		resp.Capabilities = append(resp.Capabilities, pb)
		return nil
	}); err != nil {
		return nil, err
	}

	return resp, nil
}

func capToProto(c cid.Cid, cpb *blob.Capability) (*documents.Capability, error) {
	role, ok := documents.Role_value[cpb.Role]
	if !ok {
		return nil, fmt.Errorf("unknown role '%s'", cpb.Role)
	}

	pb := &documents.Capability{
		Id:         c.String(),
		Issuer:     cpb.Issuer.String(),
		Delegate:   cpb.Delegate.String(),
		Account:    cpb.Account.String(),
		Path:       cpb.Path,
		Role:       documents.Role(role),
		IsExact:    cpb.NoRecursive,
		CreateTime: timestamppb.New(time.UnixMicro(cpb.Ts)),
	}

	return pb, nil
}
