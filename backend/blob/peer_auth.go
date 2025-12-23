package blob

import (
	"fmt"
	"seed/backend/core"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	// AuthTokenTimeout is the maximum age of an authentication token.
	AuthTokenTimeout = time.Minute
)

// peerAuthStore manages per-connection authentication state.
type peerAuthStore struct {
	mu    sync.Mutex
	peers map[peer.ID]map[core.PrincipalUnsafeString]*Capability
}

// newPeerAuthStore creates a new authentication manager.
func newPeerAuthStore() *peerAuthStore {
	return &peerAuthStore{
		peers: make(map[peer.ID]map[core.PrincipalUnsafeString]*Capability),
	}
}

// authenticatePeer verifies the authentication token and stores the authenticated peer.
func (am *peerAuthStore) authenticatePeer(callerPID peer.ID, account core.Principal, serverPID peer.ID, ts time.Time, sig core.Signature) error {
	// Create capability for authentication verification.
	cpb, err := NewEphemeralCapability(callerPID, account, serverPID, ts, sig)
	if err != nil {
		return status.Errorf(codes.Internal, "failed to create auth capability: %v", err)
	}

	// Validate timestamp freshness.
	now := time.Now()
	if now.Before(cpb.Ts.Add(-AuthTokenTimeout)) || now.After(cpb.Ts.Add(AuthTokenTimeout)) {
		return status.Errorf(codes.InvalidArgument, "timestamp out of acceptable range")
	}

	// Verify signature.
	if err := Verify(account, cpb, cpb.Sig); err != nil {
		return status.Errorf(codes.InvalidArgument, "invalid auth payload: %v", err)
	}

	// Store the authenticated peer and capability.
	am.mu.Lock()
	defer am.mu.Unlock()

	accounts, ok := am.peers[callerPID]
	if !ok {
		accounts = make(map[core.PrincipalUnsafeString]*Capability)
		am.peers[callerPID] = accounts
	}

	accounts[account.UnsafeString()] = cpb

	return nil
}

// clearPeer removes all authentication for a peer (called on disconnect).
func (am *peerAuthStore) clearPeer(pid peer.ID) {
	am.mu.Lock()
	defer am.mu.Unlock()
	delete(am.peers, pid)
}

// isAuthenticated checks if a peer has authenticated with a specific account.
func (am *peerAuthStore) isAuthenticated(pid peer.ID, account core.Principal) bool {
	am.mu.Lock()
	defer am.mu.Unlock()

	accounts, ok := am.peers[pid]
	if !ok {
		return false
	}

	_, ok = accounts[account.UnsafeString()]
	return ok
}

// accountsForPeer returns all principals a peer has authenticated with.
func (am *peerAuthStore) accountsForPeer(pid peer.ID) []core.Principal {
	am.mu.Lock()
	defer am.mu.Unlock()

	accounts, ok := am.peers[pid]
	if !ok {
		return nil
	}

	result := make([]core.Principal, 0, len(accounts))
	for _, capability := range accounts {
		result = append(result, capability.Signer)
	}
	return result
}

// NewEphemeralCapability creates a capability for authentication.
func NewEphemeralCapability(callerPID peer.ID, account core.Principal, serverPID peer.ID, ts time.Time, sig core.Signature) (*Capability, error) {
	delegate, err := core.PrincipalFromPeerID(callerPID)
	if err != nil {
		return nil, fmt.Errorf("failed to extract delegate principal from peer ID: %w", err)
	}
	audience, err := core.PrincipalFromPeerID(serverPID)
	if err != nil {
		return nil, fmt.Errorf("failed to extract audience principal from peer ID: %w", err)
	}

	return &Capability{
		BaseBlob: BaseBlob{
			Type:   TypeCapability,
			Signer: account,
			Ts:     ts,
			Sig:    sig,
		},
		Delegate: delegate,
		Audience: audience,
	}, nil
}
