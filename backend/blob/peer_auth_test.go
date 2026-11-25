package blob

import (
	"context"
	"crypto/rand"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"testing"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestAuthenticateValidToken tests that a valid authentication token is accepted.
func TestAuthenticateValidToken(t *testing.T) {
	// Create two test users with their keypairs.
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	// Alice's peer ID is derived from her device key.
	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	// Set up test infrastructure.
	ctx := context.Background()
	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, storage.InitSQLiteSchema(db))

	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)

	// Prepare authentication request: Alice authenticates to Bob with her account key.
	now := time.Now().Round(ClockPrecision)
	aliceAccount := alice.Account.Principal()

	// Create capability for authentication.
	capability, err := NewEphemeralCapability(alicePeerID, aliceAccount, bobPeerID, now, nil)
	require.NoError(t, err)

	// Sign the capability using Alice's account key.
	err = Sign(alice.Account, capability, &capability.Sig)
	require.NoError(t, err)

	// Bob's index verifies the token.
	err = idx.AuthenticatePeer(alicePeerID, aliceAccount, bobPeerID, now, capability.Sig)
	require.NoError(t, err)

	// Verify that Alice is now authenticated in Bob's system.
	isAuth := idx.isAuthenticated(alicePeerID, alice.Account.Principal())
	require.True(t, isAuth, "Alice must be authenticated after successful authentication")
}

// TestAuthenticateInvalidSignature tests that invalid signatures are rejected.
func TestAuthenticateInvalidSignature(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	ctx := context.Background()
	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, storage.InitSQLiteSchema(db))

	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)

	// Create token with invalid signature.
	now := time.Now().Round(ClockPrecision)
	badSig := make([]byte, alice.Account.SignatureSize())
	for i := range badSig {
		badSig[i] = 0xFF
	}

	// Bob's index must reject the bad signature.
	err = idx.AuthenticatePeer(alicePeerID, alice.Account.Principal(), bobPeerID, now, badSig)
	require.Error(t, err, "invalid signature must be rejected")
	require.Contains(t, err.Error(), "invalid auth payload")

	// Alice must not be authenticated.
	isAuth := idx.isAuthenticated(alicePeerID, alice.Account.Principal())
	require.False(t, isAuth, "Alice must not be authenticated with invalid signature")
}

// TestAuthenticateExpiredToken tests that tokens older than the timeout are rejected.
func TestAuthenticateExpiredToken(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	ctx := context.Background()
	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, storage.InitSQLiteSchema(db))

	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)

	// Create a token with an old timestamp (more than authTokenTimeout in the past).
	now := time.Now()
	oldTime := now.Add(-2 * time.Minute).Round(ClockPrecision)

	aliceAccount := alice.Account.Principal()
	capability, err := NewEphemeralCapability(alicePeerID, aliceAccount, bobPeerID, oldTime, nil)
	require.NoError(t, err)

	// Sign the capability.
	err = Sign(alice.Account, capability, &capability.Sig)
	require.NoError(t, err)

	// Bob's index must reject the expired token.
	err = idx.AuthenticatePeer(alicePeerID, aliceAccount, bobPeerID, oldTime, capability.Sig)
	require.Error(t, err, "expired token must be rejected")
	require.Contains(t, err.Error(), "timestamp out of acceptable range")
}

// TestAuthenticateFutureToken tests that tokens with future timestamps are rejected.
func TestAuthenticateFutureToken(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	ctx := context.Background()
	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, storage.InitSQLiteSchema(db))

	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)

	// Create a token with a future timestamp (more than authTokenTimeout in the future).
	now := time.Now()
	futureTime := now.Add(2 * time.Minute).Round(ClockPrecision)

	aliceAccount := alice.Account.Principal()
	capability, err := NewEphemeralCapability(alicePeerID, aliceAccount, bobPeerID, futureTime, nil)
	require.NoError(t, err)

	// Sign the capability.
	err = Sign(alice.Account, capability, &capability.Sig)
	require.NoError(t, err)

	// Bob's index must reject the future token.
	err = idx.AuthenticatePeer(alicePeerID, aliceAccount, bobPeerID, futureTime, capability.Sig)
	require.Error(t, err, "future token must be rejected")
	require.Contains(t, err.Error(), "timestamp out of acceptable range")
}

// TestClearPeerOnDisconnect tests that authentication is cleared when a peer disconnects.
func TestClearPeerOnDisconnect(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	ctx := context.Background()
	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, storage.InitSQLiteSchema(db))

	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)

	// Authenticate Alice.
	now := time.Now().Round(ClockPrecision)
	aliceAccount := alice.Account.Principal()
	cpb, err := NewEphemeralCapability(alicePeerID, aliceAccount, bobPeerID, now, nil)
	require.NoError(t, err)

	err = Sign(alice.Account, cpb, &cpb.Sig)
	require.NoError(t, err)

	err = idx.AuthenticatePeer(alicePeerID, aliceAccount, bobPeerID, now, cpb.Sig)
	require.NoError(t, err)

	// Verify Alice is authenticated.
	isAuth := idx.isAuthenticated(alicePeerID, alice.Account.Principal())
	require.True(t, isAuth, "Alice must be authenticated")

	// Clear Alice's authentication (simulate disconnect).
	idx.ClearPeer(alicePeerID)

	// Verify Alice is no longer authenticated.
	isAuth = idx.isAuthenticated(alicePeerID, alice.Account.Principal())
	require.False(t, isAuth, "Alice must not be authenticated after ClearPeer")
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

	ctx := context.Background()
	db, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, storage.InitSQLiteSchema(db))

	idx, err := OpenIndex(ctx, db, zap.NewNop())
	require.NoError(t, err)

	// Alice signs a token intended for Carol (audience = Carol's peer ID).
	now := time.Now().Round(ClockPrecision)
	aliceAccount := alice.Account.Principal()
	cpb, err := NewEphemeralCapability(alicePeerID, aliceAccount, carolPeerID, now, nil)
	require.NoError(t, err)

	err = Sign(alice.Account, cpb, &cpb.Sig)
	require.NoError(t, err)

	// Bob tries to verify the token. The signature will fail because the signed
	// data includes the audience field, which is different from Bob's peer ID.
	err = idx.AuthenticatePeer(alicePeerID, aliceAccount, bobPeerID, now, cpb.Sig)
	require.Error(t, err, "token with wrong audience must be rejected")
	require.Contains(t, err.Error(), "invalid auth payload")

	// Alice should not be authenticated on Bob's system.
	isAuth := idx.isAuthenticated(alicePeerID, alice.Account.Principal())
	require.False(t, isAuth, "Alice must not be authenticated with wrong audience token")
}

// TestCanPeerAccessSpace_DirectAuthentication tests access via direct authentication.
func TestCanPeerAccessSpace_DirectAuthentication(t *testing.T) {
	ctx := context.Background()

	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")

	alicePeerID := alice.Device.PeerID()
	bobPeerID := bob.Device.PeerID()

	// Set up Bob's database.
	bobDB, err := storage.OpenSQLite("file::memory:?mode=memory", 0, 1)
	require.NoError(t, err)
	defer bobDB.Close()
	require.NoError(t, storage.InitSQLiteSchema(bobDB))

	// Create blob index for Bob.
	bobIndex, err := OpenIndex(ctx, bobDB, zap.NewNop())
	require.NoError(t, err)

	// Alice authenticates with her account.
	now := time.Now().Round(ClockPrecision)
	aliceAccount := alice.Account.Principal()
	capability, err := NewEphemeralCapability(alicePeerID, aliceAccount, bobPeerID, now, nil)
	require.NoError(t, err)
	err = Sign(alice.Account, capability, &capability.Sig)
	require.NoError(t, err)
	err = bobIndex.AuthenticatePeer(alicePeerID, aliceAccount, bobPeerID, now, capability.Sig)
	require.NoError(t, err)

	// Test: Alice can access her own space via authentication.
	canAccess, err := bobIndex.canPeerAccessSpace(ctx, alicePeerID, aliceAccount)
	require.NoError(t, err, "Must not error checking authenticated space")
	require.True(t, canAccess, "Alice must be able to access her own space via authentication")

	// Test: Bob cannot access Alice's space (he hasn't authenticated).
	canAccess, err = bobIndex.canPeerAccessSpace(ctx, bobPeerID, aliceAccount)
	require.NoError(t, err, "Must not error checking unauthenticated space")
	require.False(t, canAccess, "Bob must not be able to access Alice's space without authentication")
}

// TestGetSpacesByAccount checks that an account can reach its own space plus
// the spaces that granted it a WRITER capability, and nothing else.
func TestGetSpacesByAccount(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	carol := coretest.NewTester("carol").Account
	unknown, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	clock := cclock.New()
	aliceToBob, err := NewCapability(alice, bob.Principal(), alice.Principal(), "", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	// The same grant again for another path must not duplicate the space.
	aliceToBobPath, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/shared", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	carolToBob, err := NewCapability(carol, bob.Principal(), carol.Principal(), "", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	// Agent capabilities don't grant access to the issuer's private content here.
	aliceToCarol, err := NewCapability(alice, carol.Principal(), alice.Principal(), "", RoleAgent, "", clock.MustNow())
	require.NoError(t, err)

	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{aliceToBob, aliceToBobPath, carolToBob, aliceToCarol}))

	accounts := []core.Principal{alice.Principal(), bob.Principal(), carol.Principal(), unknown.Principal()}
	got, err := idx.GetSpacesByAccount(t.Context(), accounts)
	require.NoError(t, err)

	require.Equal(t, []core.Principal{alice.Principal()}, got[alice.Principal().UnsafeString()])
	require.ElementsMatch(t, []core.Principal{bob.Principal(), alice.Principal(), carol.Principal()}, got[bob.Principal().UnsafeString()])
	require.Equal(t, []core.Principal{carol.Principal()}, got[carol.Principal().UnsafeString()])
	require.Equal(t, []core.Principal{unknown.Principal()}, got[unknown.Principal().UnsafeString()])
	require.Len(t, got, len(accounts))
}
