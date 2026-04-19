package keystore

import (
	"context"
	"crypto/rand"
	"seed/backend/core"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFile(t *testing.T) {
	dir := t.TempDir()
	ks, err := NewFile(dir)
	require.NoError(t, err)

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	kp2, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	ctx := context.Background()

	keys, err := ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 0)

	_, err = ks.GetKey(ctx, "keyName")
	require.Error(t, err)

	require.NoError(t, ks.StoreKey(ctx, "keyName", kp))
	key, err := ks.GetKey(ctx, "keyName")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), key.Principal())

	require.Error(t, ks.StoreKey(ctx, "keyName", kp2))

	require.NoError(t, ks.StoreKey(ctx, "anotherKey", kp2))
	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 2)

	require.NoError(t, ks.ChangeKeyName(ctx, "keyName", "renamedKey"))
	_, err = ks.GetKey(ctx, "keyName")
	require.Error(t, err)
	key, err = ks.GetKey(ctx, "renamedKey")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), key.Principal())

	require.NoError(t, ks.DeleteKey(ctx, "renamedKey"))
	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 1)

	require.NoError(t, ks.DeleteAllKeys(ctx))
	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 0)
}
