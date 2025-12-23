package hmnet

import (
	"context"
	"fmt"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc/codes"
	rpcpeer "google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

// Authenticate is the RPC server handler for the Authenticate method.
func (srv *rpcMux) Authenticate(ctx context.Context, in *p2p.AuthenticateRequest) (*p2p.AuthenticateResponse, error) {
	// Extract the caller's peer ID from the gRPC context.
	callerPeer, err := getRemoteID(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to extract peer ID: %v", err)
	}

	// Parse the account principal.
	account, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid account: %v", err)
	}

	// Authenticate using the AuthManager.
	ts := time.UnixMilli(in.Timestamp)
	if err := srv.Node.index.AuthenticatePeer(callerPeer, account, srv.Node.p2p.ID(), ts, in.Signature); err != nil {
		return nil, err
	}

	return &p2p.AuthenticateResponse{}, nil
}

// getRemoteID gets the remote peer ID from the gRPC context.
// gostream provides the peer ID in the connection's RemoteAddr field.
func getRemoteID(ctx context.Context) (peer.ID, error) {
	info, ok := rpcpeer.FromContext(ctx)
	if !ok {
		return "", fmt.Errorf("BUG: no peer info in context for grpc")
	}

	pid, err := peer.Decode(info.Addr.String())
	if err != nil {
		return "", err
	}

	return pid, nil
}
