package hmnet

import (
	"context"
	"fmt"
	"seed/backend/blob"
	"seed/backend/core"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc/codes"
	rpcpeer "google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

const (
	// authTokenTimeout is the maximum age of an authentication token.
	authTokenTimeout = time.Minute
)

// newAuthCapability creates a capability for authentication.
func newAuthCapability(callerPID peer.ID, account core.Principal, serverPID peer.ID, ts time.Time, sig core.Signature) (*blob.Capability, error) {
	delegate, err := core.PrincipalFromPeerID(callerPID)
	if err != nil {
		return nil, fmt.Errorf("failed to extract delegate principal from peer ID: %w", err)
	}
	audience, err := core.PrincipalFromPeerID(serverPID)
	if err != nil {
		return nil, fmt.Errorf("failed to extract audience principal from peer ID: %w", err)
	}

	return &blob.Capability{
		BaseBlob: blob.BaseBlob{
			Type:   blob.TypeCapability,
			Signer: account,
			Ts:     ts,
			Sig:    sig,
		},
		Delegate: delegate,
		Audience: audience,
	}, nil
}

// authManager manages per-connection authentication state.
type authManager struct {
	mu    sync.Mutex
	peers map[peer.ID]map[core.PrincipalUnsafeMapKey]*blob.Capability
}

// newAuthManager creates a new authentication manager.
func newAuthManager() *authManager {
	return &authManager{
		peers: make(map[peer.ID]map[core.PrincipalUnsafeMapKey]*blob.Capability),
	}
}

// Authenticate verifies the authentication token and stores the authenticated peer.
func (am *authManager) Authenticate(callerPID peer.ID, account core.Principal, serverPID peer.ID, ts time.Time, sig core.Signature) error {
	// Create capability for authentication verification.
	cap, err := newAuthCapability(callerPID, account, serverPID, ts, sig)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to create auth capability: %v", err)
	}

	// Validate timestamp freshness.
	now := time.Now()
	if now.Before(cap.Ts.Add(-authTokenTimeout)) || now.After(cap.Ts.Add(authTokenTimeout)) {
		return status.Errorf(codes.InvalidArgument, "timestamp out of acceptable range")
	}

	// Verify signature.
	if err := blob.Verify(account, cap, cap.Sig); err != nil {
		return status.Errorf(codes.InvalidArgument, "invalid auth payload: %v", err)
	}

	// Store the authenticated peer and capability.
	am.mu.Lock()
	defer am.mu.Unlock()

	accounts, ok := am.peers[callerPID]
	if !ok {
		accounts = make(map[core.PrincipalUnsafeMapKey]*blob.Capability)
		am.peers[callerPID] = accounts
	}

	accounts[account.MapKey()] = cap

	return nil
}

// ClearPeer removes all authentication for a peer (called on disconnect).
func (am *authManager) ClearPeer(pid peer.ID) {
	am.mu.Lock()
	defer am.mu.Unlock()
	delete(am.peers, pid)
}

// IsAuthenticated checks if a peer has authenticated with a specific account.
func (am *authManager) IsAuthenticated(pid peer.ID, account core.Principal) bool {
	am.mu.Lock()
	defer am.mu.Unlock()

	accounts, ok := am.peers[pid]
	if !ok {
		return false
	}

	_, ok = accounts[account.MapKey()]
	return ok
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
	if err := srv.Node.authManager.Authenticate(callerPeer, account, srv.Node.p2p.ID(), ts, in.Signature); err != nil {
		return nil, err
	}

	return &p2p.AuthenticateResponse{}, nil
}
