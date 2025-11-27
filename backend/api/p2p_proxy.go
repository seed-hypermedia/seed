package api

import (
	"context"
	"errors"
	"io"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet"

	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// p2pProxy is an implementation of our P2P APIs
// exposed on as a regular gRPC server, which allows
// external clients to interact with other P2P peers over libp2p.
//
// All methods exposed by this server require a 'target-peer' metadata key,
// which must be a valid string PeerID of the target peer that the client wants to interact with.
type p2pProxy struct {
	node *hmnet.Node
}

func (p *p2pProxy) RegisterServer(srv grpc.ServiceRegistrar) {
	p2p.RegisterP2PServer(srv, p)
	p2p.RegisterSyncingServer(srv, p)
}

func (p *p2pProxy) AnnounceBlobs(in *p2p.AnnounceBlobsRequest, stream p2p.Syncing_AnnounceBlobsServer) error {
	ctx := stream.Context()
	pid, err := p.targetPeer(ctx)
	if err != nil {
		return err
	}

	client, err := p.node.SyncingClient(ctx, pid)
	if err != nil {
		return err
	}

	resp, err := client.AnnounceBlobs(ctx, in)
	if err != nil {
		return err
	}

	for {
		msg, err := resp.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}

		if err := stream.Send(msg); err != nil {
			return err
		}
	}

	return nil
}
func (p *p2pProxy) ListBlobs(in *p2p.ListBlobsRequest, stream p2p.P2P_ListBlobsServer) error {
	ctx := stream.Context()

	pid, err := p.targetPeer(ctx)
	if err != nil {
		return err
	}

	client, err := p.node.Client(ctx, pid)
	if err != nil {
		return err
	}

	resp, err := client.ListBlobs(ctx, in)
	if err != nil {
		return err
	}

	for {
		msg, err := resp.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}

		if err := stream.Send(msg); err != nil {
			return err
		}
	}

	return nil
}

func (p *p2pProxy) ListPeers(ctx context.Context, in *p2p.ListPeersRequest) (*p2p.ListPeersResponse, error) {
	pid, err := p.targetPeer(ctx)
	if err != nil {
		return nil, err
	}

	client, err := p.node.Client(ctx, pid)
	if err != nil {
		return nil, err
	}

	return client.ListPeers(ctx, in)
}

func (p *p2pProxy) ListSpaces(ctx context.Context, in *p2p.ListSpacesRequest) (*p2p.ListSpacesResponse, error) {
	pid, err := p.targetPeer(ctx)
	if err != nil {
		return nil, err
	}

	client, err := p.node.Client(ctx, pid)
	if err != nil {
		return nil, err
	}

	return client.ListSpaces(ctx, in)
}

func (p *p2pProxy) RequestInvoice(ctx context.Context, in *p2p.RequestInvoiceRequest) (*p2p.RequestInvoiceResponse, error) {
	pid, err := p.targetPeer(ctx)
	if err != nil {
		return nil, err
	}

	client, err := p.node.Client(ctx, pid)
	if err != nil {
		return nil, err
	}

	return client.RequestInvoice(ctx, in)
}

func (p *p2pProxy) ReconcileBlobs(ctx context.Context, in *p2p.ReconcileBlobsRequest) (*p2p.ReconcileBlobsResponse, error) {
	pid, err := p.targetPeer(ctx)
	if err != nil {
		return nil, err
	}

	client, err := p.node.SyncingClient(ctx, pid)
	if err != nil {
		return nil, err
	}

	return client.ReconcileBlobs(ctx, in)
}

func (p *p2pProxy) targetPeer(ctx context.Context) (peer.ID, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", status.Errorf(codes.InvalidArgument, "missing 'target-peer' metadata key")
	}

	peerValues := md.Get("target-peer")
	if len(peerValues) != 1 {
		return "", status.Errorf(codes.InvalidArgument, "expected exactly one 'target-peer' metadata value")
	}

	pid, err := peer.Decode(peerValues[0])
	if err != nil {
		return "", status.Errorf(codes.InvalidArgument, "invalid peer ID '%s': %v", peerValues[0], err)
	}

	return pid, nil
}
