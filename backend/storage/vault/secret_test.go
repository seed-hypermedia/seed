package vault

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDecodeSecret(t *testing.T) {
	secret := bytes.Repeat([]byte{0x11}, vaultSecretSize)
	encoded := base64.StdEncoding.EncodeToString(secret)

	got, err := decodeSecret(encoded)
	require.NoError(t, err)
	require.Equal(t, secret, got)
}

func TestDecodeSecretRejectsInvalidValues(t *testing.T) {
	_, err := decodeSecret("not-base64")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed decoding vault secret")

	_, err = decodeSecret(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x01}, vaultSecretSize-1)))
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid vault secret length")
}

func TestRemoteVaultKEKName(t *testing.T) {
	key, err := remoteVaultKEKName("https://example.com/vault", "user-123")
	require.NoError(t, err)
	require.Equal(t, "https://example.com/vault|user-123", key)

	_, err = remoteVaultKEKName("", "user-123")
	require.Error(t, err)

	_, err = remoteVaultKEKName("https://example.com/vault", "")
	require.Error(t, err)
}

func TestDeriveRemoteAuthKey(t *testing.T) {
	secret := bytes.Repeat([]byte{0x22}, vaultSecretSize)

	first, err := deriveRemoteAuthKey(secret)
	require.NoError(t, err)
	second, err := deriveRemoteAuthKey(secret)
	require.NoError(t, err)

	require.Len(t, first, vaultSecretSize)
	require.Equal(t, first, second)
	require.NotEqual(t, secret, first)
}

func Example_decodeSecret() {
	secret, _ := decodeSecret(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x11}, vaultSecretSize)))
	fmt.Println(len(secret))
	// Output: 32
}
