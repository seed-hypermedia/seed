package keystore

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"seed/backend/core"
	"seed/backend/testutil"

	"github.com/stretchr/testify/require"
)

func TestOS(t *testing.T) {
	testutil.Manual(t)
	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	kp2, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	ks := NewOS("test-manual")
	ctx := context.Background()
	t.Cleanup(func() {
		_ = ks.DeleteAllKeys(ctx)
	})

	_ = ks.DeleteAllKeys(ctx)

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
	keyPairs, err := ks.ListKeyPairs(ctx)
	require.NoError(t, err)
	require.Len(t, keyPairs, 2)
	principalsByName := make(map[string]core.Principal, len(keyPairs))
	for _, keyPair := range keyPairs {
		require.NotNil(t, keyPair.KeyPair)
		principalsByName[keyPair.Name] = keyPair.Principal()
	}
	require.Equal(t, map[string]core.Principal{
		"keyName":        kp.Principal(),
		"anotherKeyName": kp2.Principal(),
	}, principalsByName)
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

func TestDecodeKeyringSecret(t *testing.T) {
	plainJSON := `{"mykey":"CAESQ..."}`

	t.Run("PlainJSON", func(t *testing.T) {
		got, err := decodeKeyringSecret(plainJSON)
		require.NoError(t, err)
		require.Equal(t, plainJSON, got)
	})

	t.Run("Base64Prefixed", func(t *testing.T) {
		encoded := goKeyringBase64Prefix + base64.StdEncoding.EncodeToString([]byte(plainJSON))
		got, err := decodeKeyringSecret(encoded)
		require.NoError(t, err)
		require.Equal(t, plainJSON, got)
	})

	t.Run("InvalidBase64", func(t *testing.T) {
		_, err := decodeKeyringSecret(goKeyringBase64Prefix + "!!!not-valid-base64!!!")
		require.Error(t, err)
		require.Contains(t, err.Error(), "failed to decode base64 keyring value")
	})

	t.Run("EmptyString", func(t *testing.T) {
		got, err := decodeKeyringSecret("")
		require.NoError(t, err)
		require.Equal(t, "", got)
	})

	t.Run("PrefixOnly", func(t *testing.T) {
		got, err := decodeKeyringSecret(goKeyringBase64Prefix)
		require.NoError(t, err)
		require.Equal(t, "", got)
	})
}
