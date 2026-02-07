package core

import (
	"context"
	"crypto/rand"
	"seed/backend/testutil"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOSKeyStore(t *testing.T) {
	testutil.Manual(t)
	kp, err := GenerateKeyPair(Ed25519, rand.Reader)
	require.NoError(t, err)

	kp2, err := GenerateKeyPair(Ed25519, rand.Reader)
	require.NoError(t, err)

	ks := NewOSKeyStore("test-manual")
	ctx := context.Background()
	t.Cleanup(func() {
		_ = ks.DeleteAllKeys(ctx) // best effort cleanup after tests finished.
	})

	_ = ks.DeleteAllKeys(ctx) // best effort cleanup in case previous runs left anything behind.

	emptyKey, err := ks.GetKey(ctx, "keyName")
	require.Error(t, err)
	keys, err := ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 0)
	require.NoError(t, ks.StoreKey(ctx, "keyName", kp))
	key, err := ks.GetKey(ctx, "keyName")
	require.NoError(t, err)
	require.Equal(t, kp, key)
	emptyKey, err = ks.GetKey(ctx, "wrongKeyName")
	require.Error(t, err)
	require.Empty(t, emptyKey)
	require.Error(t, ks.StoreKey(ctx, "keyName", kp2))
	require.NoError(t, ks.StoreKey(ctx, "anotherKeyName", kp2))
	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 2)
	require.Error(t, ks.ChangeKeyName(ctx, "wrongKeyName", "someName"))
	require.NoError(t, ks.ChangeKeyName(ctx, "keyName", "changedName"))
	emptyKey, err = ks.GetKey(ctx, "keyName")
	require.Error(t, err)
	require.Empty(t, emptyKey)
	key, err = ks.GetKey(ctx, "changedName")
	require.NoError(t, err)
	require.Equal(t, kp, key)
	require.Error(t, ks.DeleteKey(ctx, "wrongKeyName"))
	require.NoError(t, ks.DeleteKey(ctx, "changedName"))
	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 1)
	require.Equal(t, kp2.PublicKey.Principal(), keys[0].PublicKey)
}

func removeKeys(ctx context.Context, ks KeyStore) error {
	collection, err := ks.ListKeys(ctx)
	if err != nil {
		return err
	}
	for _, name := range collection {
		err = ks.DeleteKey(ctx, name.Name)
		if err != nil {
			return err
		}
	}
	return nil
}

func TestCompositeKeyStore(t *testing.T) {
	ctx := context.Background()

	// Create two memory stores.
	primary := NewMemoryKeyStore()
	secondary := NewMemoryKeyStore()

	// Create composite: primary first, then secondary.
	composite := NewCompositeKeyStore(primary, secondary)

	// Generate test keys.
	kp1, err := GenerateKeyPair(Ed25519, rand.Reader)
	require.NoError(t, err)
	kp2, err := GenerateKeyPair(Ed25519, rand.Reader)
	require.NoError(t, err)

	// Store key in secondary (simulating ephemeral key registered elsewhere).
	require.NoError(t, secondary.StoreKey(ctx, "ephemeral-key", kp1))

	// Store key in primary.
	require.NoError(t, primary.StoreKey(ctx, "persistent-key", kp2))

	// Composite must find key from secondary.
	got, err := composite.GetKey(ctx, "ephemeral-key")
	require.NoError(t, err)
	require.Equal(t, kp1.PublicKey, got.PublicKey)

	// Composite must find key from primary.
	got, err = composite.GetKey(ctx, "persistent-key")
	require.NoError(t, err)
	require.Equal(t, kp2.PublicKey, got.PublicKey)

	// ListKeys must return both.
	keys, err := composite.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 2)

	// StoreKey via composite must go to primary.
	kp3, err := GenerateKeyPair(Ed25519, rand.Reader)
	require.NoError(t, err)
	require.NoError(t, composite.StoreKey(ctx, "new-key", kp3))
	_, err = primary.GetKey(ctx, "new-key")
	require.NoError(t, err, "new key must be stored in primary")

	// DeleteKey must delete from correct store.
	require.NoError(t, composite.DeleteKey(ctx, "ephemeral-key"))
	_, err = secondary.GetKey(ctx, "ephemeral-key")
	require.Error(t, err, "key must be deleted from secondary")
}
