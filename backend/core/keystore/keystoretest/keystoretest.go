// Package keystoretest contains shared conformance tests for core.KeyStore implementations.
package keystoretest

import (
	"crypto/rand"
	"testing"

	"seed/backend/core"

	"github.com/stretchr/testify/require"
)

// RunConformanceTests verifies behavior shared by all core.KeyStore implementations.
func RunConformanceTests(t *testing.T, newStore func(t *testing.T) core.KeyStore) {
	t.Helper()

	t.Run("GetKeyByPublicKeyAfterNameMiss", func(t *testing.T) {
		ctx := t.Context()
		ks := newStore(t)
		kp := newKeyPair(t)

		require.NoError(t, ks.StoreKey(ctx, "main", kp))

		got, err := ks.GetKey(ctx, kp.Principal().String())
		require.NoError(t, err)
		require.Equal(t, kp.Principal(), got.Principal())
	})

	t.Run("DeleteKeyByPublicKeyAfterNameMiss", func(t *testing.T) {
		ctx := t.Context()
		ks := newStore(t)
		kp := newKeyPair(t)

		require.NoError(t, ks.StoreKey(ctx, "main", kp))
		require.NoError(t, ks.DeleteKey(ctx, kp.Principal().String()))

		_, err := ks.GetKey(ctx, "main")
		require.Error(t, err)
	})

	t.Run("ChangeKeyNameByPublicKeyAfterNameMiss", func(t *testing.T) {
		ctx := t.Context()
		ks := newStore(t)
		kp := newKeyPair(t)

		require.NoError(t, ks.StoreKey(ctx, "main", kp))
		require.NoError(t, ks.ChangeKeyName(ctx, kp.Principal().String(), "renamed"))

		_, err := ks.GetKey(ctx, "main")
		require.Error(t, err)
		got, err := ks.GetKey(ctx, "renamed")
		require.NoError(t, err)
		require.Equal(t, kp.Principal(), got.Principal())
	})

	t.Run("ChangeKeyNameByPublicKeyToSamePublicKey", func(t *testing.T) {
		ctx := t.Context()
		ks := newStore(t)
		kp := newKeyPair(t)
		principal := kp.Principal().String()

		require.NoError(t, ks.StoreKey(ctx, "main", kp))
		require.NoError(t, ks.ChangeKeyName(ctx, principal, principal))

		_, err := ks.GetKey(ctx, "main")
		require.Error(t, err)
		got, err := ks.GetKey(ctx, principal)
		require.NoError(t, err)
		require.Equal(t, kp.Principal(), got.Principal())
	})

	t.Run("ExactNameWinsBeforePublicKeyLookup", func(t *testing.T) {
		ctx := t.Context()
		ks := newStore(t)
		kp := newKeyPair(t)

		require.NoError(t, ks.StoreKey(ctx, kp.Principal().String(), kp))

		got, err := ks.GetKey(ctx, kp.Principal().String())
		require.NoError(t, err)
		require.Equal(t, kp.Principal(), got.Principal())
	})

	t.Run("RejectNameThatParsesAsAnotherPublicKey", func(t *testing.T) {
		ctx := t.Context()
		ks := newStore(t)
		kp := newKeyPair(t)
		other := newKeyPair(t)

		require.Error(t, ks.StoreKey(ctx, other.Principal().String(), kp))
		require.NoError(t, ks.StoreKey(ctx, "main", kp))
		require.Error(t, ks.ChangeKeyName(ctx, "main", other.Principal().String()))
	})
}

func newKeyPair(t *testing.T) *core.KeyPair {
	t.Helper()
	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	return kp
}
