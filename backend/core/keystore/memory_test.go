package keystore

import (
	"context"
	"crypto/rand"
	"testing"

	"seed/backend/core"

	"github.com/stretchr/testify/require"
)

func TestMemoryListKeyPairs(t *testing.T) {
	ctx := context.Background()
	ks := NewMemory()

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	kp2, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	require.NoError(t, ks.StoreKey(ctx, "main", kp))
	require.NoError(t, ks.StoreKey(ctx, "second", kp2))

	keyPairs, err := ks.ListKeyPairs(ctx)
	require.NoError(t, err)
	require.Len(t, keyPairs, 2)

	principalsByName := make(map[string]core.Principal, len(keyPairs))
	for _, keyPair := range keyPairs {
		require.NotNil(t, keyPair.KeyPair)
		principalsByName[keyPair.Name] = keyPair.Principal()
	}

	require.Equal(t, map[string]core.Principal{
		"main":   kp.Principal(),
		"second": kp2.Principal(),
	}, principalsByName)
}
