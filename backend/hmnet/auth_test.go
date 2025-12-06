package hmnet

import (
	"seed/backend/blob"
	"seed/backend/core/coretest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestAuthenticateValidToken tests that a valid authentication token is accepted.
func TestAuthenticateValidToken(t *testing.T) {
	// Create two test users with their keypairs.
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	// Alice's peer ID is derived from her device key.
	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	// Bob's authentication manager.
	bobAuthMgr := newAuthManager()

	// Prepare authentication request: Alice authenticates to Bob with her account key.
	now := time.Now().Round(blob.ClockPrecision)
	aliceAccount := alice.Account.Principal()

	// Create capability for authentication.
	capability, err := newAuthCapability(alicePeerID, aliceAccount, bobPeerID, now, nil)
	require.NoError(t, err)

	// Sign the capability using Alice's account key.
	err = blob.Sign(alice.Account, capability, &capability.Sig)
	require.NoError(t, err)

	// Bob's authentication manager verifies the token.
	err = bobAuthMgr.Authenticate(alicePeerID, aliceAccount, bobPeerID, now, capability.Sig)
	require.NoError(t, err)

	// Verify that Alice is now authenticated in Bob's system.
	isAuth := bobAuthMgr.IsAuthenticated(alicePeerID, alice.Account.Principal())
	require.True(t, isAuth, "Alice must be authenticated after successful authentication")
}

// TestAuthenticateInvalidSignature tests that invalid signatures are rejected.
func TestAuthenticateInvalidSignature(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	bobAuthMgr := newAuthManager()

	// Create token with invalid signature.
	now := time.Now().Round(blob.ClockPrecision)
	badSig := make([]byte, alice.Account.SignatureSize())
	for i := range badSig {
		badSig[i] = 0xFF
	}

	// Bob's authentication manager must reject the bad signature.
	err := bobAuthMgr.Authenticate(alicePeerID, alice.Account.Principal(), bobPeerID, now, badSig)
	require.Error(t, err, "invalid signature must be rejected")
	require.Contains(t, err.Error(), "invalid auth payload")

	// Alice must not be authenticated.
	isAuth := bobAuthMgr.IsAuthenticated(alicePeerID, alice.Account.Principal())
	require.False(t, isAuth, "Alice must not be authenticated with invalid signature")
}

// TestAuthenticateExpiredToken tests that tokens older than the timeout are rejected.
func TestAuthenticateExpiredToken(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	bobAuthMgr := newAuthManager()

	// Create a token with an old timestamp (more than authTokenTimeout in the past).
	now := time.Now()
	oldTime := now.Add(-2 * time.Minute).Round(blob.ClockPrecision)

	aliceAccount := alice.Account.Principal()
	capability, err := newAuthCapability(alicePeerID, aliceAccount, bobPeerID, oldTime, nil)
	require.NoError(t, err)

	// Sign the capability.
	err = blob.Sign(alice.Account, capability, &capability.Sig)
	require.NoError(t, err)

	// Bob's authentication manager must reject the expired token.
	err = bobAuthMgr.Authenticate(alicePeerID, aliceAccount, bobPeerID, oldTime, capability.Sig)
	require.Error(t, err, "expired token must be rejected")
	require.Contains(t, err.Error(), "timestamp out of acceptable range")
}

// TestAuthenticateFutureToken tests that tokens with future timestamps are rejected.
func TestAuthenticateFutureToken(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	bobAuthMgr := newAuthManager()

	// Create a token with a future timestamp (more than authTokenTimeout in the future).
	now := time.Now()
	futureTime := now.Add(2 * time.Minute).Round(blob.ClockPrecision)

	aliceAccount := alice.Account.Principal()
	capability, err := newAuthCapability(alicePeerID, aliceAccount, bobPeerID, futureTime, nil)
	require.NoError(t, err)

	// Sign the capability.
	err = blob.Sign(alice.Account, capability, &capability.Sig)
	require.NoError(t, err)

	// Bob's authentication manager must reject the future token.
	err = bobAuthMgr.Authenticate(alicePeerID, aliceAccount, bobPeerID, futureTime, capability.Sig)
	require.Error(t, err, "future token must be rejected")
	require.Contains(t, err.Error(), "timestamp out of acceptable range")
}

// TestAuthenticateTokenWithinTolerance tests that tokens within the tolerance window are accepted.
func TestAuthenticateTokenWithinTolerance(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	bobAuthMgr := newAuthManager()

	// Create tokens at the edge of acceptable timestamp ranges.
	now := time.Now()

	testCases := []struct {
		name   string
		offset time.Duration
	}{
		{"token 30 seconds old", -30 * time.Second},
		{"token 59 seconds old", -59 * time.Second},
		{"token 30 seconds in future", 30 * time.Second},
		{"token 59 seconds in future", 59 * time.Second},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			ts := now.Add(tc.offset).Round(blob.ClockPrecision)
			aliceAccount := alice.Account.Principal()

			cap, err := newAuthCapability(alicePeerID, aliceAccount, bobPeerID, ts, nil)
			require.NoError(t, err)

			err = blob.Sign(alice.Account, cap, &cap.Sig)
			require.NoError(t, err)

			err = bobAuthMgr.Authenticate(alicePeerID, aliceAccount, bobPeerID, ts, cap.Sig)
			require.NoError(t, err, "token %s must be accepted", tc.name)
		})
	}
}

// TestAuthenticateMultipleAccounts tests that a peer can authenticate with multiple accounts.
func TestAuthenticateMultipleAccounts(t *testing.T) {
	// Alice has two account keypairs (device and account).
	alice := coretest.NewTester("alice")
	alice2 := coretest.NewTester("alice-2")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	bobAuthMgr := newAuthManager()

	// Alice authenticates with her first account.
	now := time.Now().Round(blob.ClockPrecision)
	aliceAccount := alice.Account.Principal()

	cap1, err := newAuthCapability(alicePeerID, aliceAccount, bobPeerID, now, nil)
	require.NoError(t, err)

	err = blob.Sign(alice.Account, cap1, &cap1.Sig)
	require.NoError(t, err)

	err = bobAuthMgr.Authenticate(alicePeerID, aliceAccount, bobPeerID, now, cap1.Sig)
	require.NoError(t, err)

	// Alice authenticates with her second account (from alice-2 tester).
	alice2Account := alice2.Account.Principal()
	cap2, err := newAuthCapability(alicePeerID, alice2Account, bobPeerID, now, nil)
	require.NoError(t, err)

	err = blob.Sign(alice2.Account, cap2, &cap2.Sig)
	require.NoError(t, err)

	err = bobAuthMgr.Authenticate(alicePeerID, alice2Account, bobPeerID, now, cap2.Sig)
	require.NoError(t, err)

	// Verify both accounts are authenticated.
	isAuth1 := bobAuthMgr.IsAuthenticated(alicePeerID, alice.Account.Principal())
	require.True(t, isAuth1, "account1 must be authenticated")

	isAuth2 := bobAuthMgr.IsAuthenticated(alicePeerID, alice2.Account.Principal())
	require.True(t, isAuth2, "account2 must be authenticated")
}

// TestClearPeerOnDisconnect tests that authentication is cleared when a peer disconnects.
func TestClearPeerOnDisconnect(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	bobAuthMgr := newAuthManager()

	// Authenticate Alice.
	now := time.Now().Round(blob.ClockPrecision)
	aliceAccount := alice.Account.Principal()
	cap, err := newAuthCapability(alicePeerID, aliceAccount, bobPeerID, now, nil)
	require.NoError(t, err)

	err = blob.Sign(alice.Account, cap, &cap.Sig)
	require.NoError(t, err)

	err = bobAuthMgr.Authenticate(alicePeerID, aliceAccount, bobPeerID, now, cap.Sig)
	require.NoError(t, err)

	// Verify Alice is authenticated.
	isAuth := bobAuthMgr.IsAuthenticated(alicePeerID, alice.Account.Principal())
	require.True(t, isAuth, "Alice must be authenticated")

	// Clear Alice's authentication (simulate disconnect).
	bobAuthMgr.ClearPeer(alicePeerID)

	// Verify Alice is no longer authenticated.
	isAuth = bobAuthMgr.IsAuthenticated(alicePeerID, alice.Account.Principal())
	require.False(t, isAuth, "Alice must not be authenticated after ClearPeer")
}

// TestMultiplePeersAuthentication tests authentication with multiple peer connections.
func TestMultiplePeersAuthentication(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")
	carol := coretest.NewTester("carol")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()
	carolPeerID := carol.Device.PeerID()

	// Carol's auth manager (she's the server).
	carolAuthMgr := newAuthManager()

	// Alice authenticates with Carol.
	now := time.Now().Round(blob.ClockPrecision)
	aliceAccount := alice.Account.Principal()
	aliceCap, err := newAuthCapability(alicePeerID, aliceAccount, carolPeerID, now, nil)
	require.NoError(t, err)

	err = blob.Sign(alice.Account, aliceCap, &aliceCap.Sig)
	require.NoError(t, err)

	err = carolAuthMgr.Authenticate(alicePeerID, aliceAccount, carolPeerID, now, aliceCap.Sig)
	require.NoError(t, err)

	// Bob also authenticates with Carol.
	bobAccount := bob.Account.Principal()
	bobCap, err := newAuthCapability(bobPeerID, bobAccount, carolPeerID, now, nil)
	require.NoError(t, err)

	err = blob.Sign(bob.Account, bobCap, &bobCap.Sig)
	require.NoError(t, err)

	err = carolAuthMgr.Authenticate(bobPeerID, bobAccount, carolPeerID, now, bobCap.Sig)
	require.NoError(t, err)

	// Both are authenticated.
	require.True(t, carolAuthMgr.IsAuthenticated(alicePeerID, alice.Account.Principal()))
	require.True(t, carolAuthMgr.IsAuthenticated(bobPeerID, bob.Account.Principal()))

	// Clear one peer.
	carolAuthMgr.ClearPeer(alicePeerID)

	// Only Bob remains authenticated.
	require.False(t, carolAuthMgr.IsAuthenticated(alicePeerID, alice.Account.Principal()))
	require.True(t, carolAuthMgr.IsAuthenticated(bobPeerID, bob.Account.Principal()))
}

// TestAuthenticateWrongAudience tests that tokens with mismatched audience are rejected.
// This ensures replay protection: a token signed for one peer cannot be used for another.
func TestAuthenticateWrongAudience(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")
	carol := coretest.NewTester("carol")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()
	carolPeerID := carol.Device.PeerID()

	bobAuthMgr := newAuthManager()

	// Alice signs a token intended for Carol (audience = Carol's peer ID).
	now := time.Now().Round(blob.ClockPrecision)
	aliceAccount := alice.Account.Principal()
	cap, err := newAuthCapability(alicePeerID, aliceAccount, carolPeerID, now, nil)
	require.NoError(t, err)

	err = blob.Sign(alice.Account, cap, &cap.Sig)
	require.NoError(t, err)

	// Bob tries to verify the token. The signature will fail because the signed
	// data includes the audience field, which is different from Bob's peer ID.
	err = bobAuthMgr.Authenticate(alicePeerID, aliceAccount, bobPeerID, now, cap.Sig)
	require.Error(t, err, "token with wrong audience must be rejected")
	require.Contains(t, err.Error(), "invalid auth payload")

	// Alice should not be authenticated on Bob's system.
	isAuth := bobAuthMgr.IsAuthenticated(alicePeerID, alice.Account.Principal())
	require.False(t, isAuth, "Alice must not be authenticated with wrong audience token")
}
