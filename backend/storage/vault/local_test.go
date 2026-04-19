package vault

import (
	"context"
	"crypto/rand"
	"testing"
	"time"

	"seed/backend/core"

	cid "github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/chacha20poly1305"
)

func TestLocal(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	secretStore := NewMemorySecretStore()
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	ks, err := newLocalStore(dir, secretStore)
	require.NoError(t, err)

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	kp2, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	keys, err := ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 0)

	require.Error(t, ks.StoreKey(ctx, "invalid name", kp))
	require.Error(t, ks.StoreKey(ctx, "main", nil))

	require.NoError(t, ks.StoreKey(ctx, "main", kp))
	require.Error(t, ks.StoreKey(ctx, "main", kp2))

	got, err := ks.GetKey(ctx, "main")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), got.Principal())

	require.NoError(t, ks.StoreKey(ctx, "second", kp2))
	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 2)

	require.NoError(t, ks.ChangeKeyName(ctx, "main", "renamed"))
	_, err = ks.GetKey(ctx, "main")
	require.Error(t, err)
	got, err = ks.GetKey(ctx, "renamed")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), got.Principal())

	require.Error(t, ks.DeleteKey(ctx, "missing"))
	require.NoError(t, ks.DeleteKey(ctx, "renamed"))

	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 1)
	require.Equal(t, "second", keys[0].Name)
	require.Equal(t, kp2.PublicKey.Principal(), keys[0].PublicKey)

	envelope, err := load(dir)
	require.NoError(t, err)
	require.NotNil(t, envelope)
	require.Nil(t, envelope.Remote)
	require.NotEmpty(t, envelope.EncryptedData)

	require.NoError(t, ks.DeleteAllKeys(ctx))
	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 0)
}

func TestLocalPersistsAcrossInstances(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	keyMaterial := []byte("fedcba9876543210fedcba9876543210")
	firstStore := NewMemorySecretStore()
	require.NoError(t, firstStore.Store(localVaultKEKName, keyMaterial))

	first, err := newLocalStore(dir, firstStore)
	require.NoError(t, err)

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	require.NoError(t, first.StoreKey(ctx, "main", kp))

	secondStore := NewMemorySecretStore()
	require.NoError(t, secondStore.Store(localVaultKEKName, keyMaterial))
	second, err := newLocalStore(dir, secondStore)
	require.NoError(t, err)

	got, err := second.GetKey(ctx, "main")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), got.Principal())
}

func TestLocalStoreKeyWithMetadata(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	keyMaterial := []byte("fedcba9876543210fedcba9876543210")
	secretStore := NewMemorySecretStore()
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	ks, err := newLocalStore(dir, secretStore)
	require.NoError(t, err)

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	delegateKey, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	capabilityCID, err := cid.Decode("bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku")
	require.NoError(t, err)

	createTime := time.Unix(1_700_000_000, 0).UTC()
	delegationTime := createTime.Add(time.Minute)
	err = ks.StoreKeyWithMetadata(ctx, "main", kp, KeyMetadata{
		CreateTime: createTime,
		Delegations: []Delegation{{
			ClientID:      "https://example.com",
			DeviceType:    "desktop",
			CapabilityCID: capabilityCID,
			Delegate:      delegateKey.Principal(),
			CreateTime:    delegationTime,
		}},
	})
	require.NoError(t, err)

	envelope, state, err := ks.loadState()
	require.NoError(t, err)
	require.NotNil(t, envelope)
	require.Len(t, state.Accounts, 1)
	require.Equal(t, createTime.UnixMilli(), state.Accounts[0].CreateTime)
	require.Len(t, state.Accounts[0].Delegations, 1)
	require.Equal(t, "https://example.com", state.Accounts[0].Delegations[0].ClientID)
	require.Equal(t, "desktop", state.Accounts[0].Delegations[0].DeviceType)
	require.Equal(t, capabilityCID, state.Accounts[0].Delegations[0].Capability.CID)
	require.Equal(t, delegateKey.Principal(), state.Accounts[0].Delegations[0].Capability.Delegate)
	require.Equal(t, delegationTime.UnixMilli(), state.Accounts[0].Delegations[0].CreateTime)
}

func TestLocalRejectsInvalidConfiguration(t *testing.T) {
	secretStore := NewMemorySecretStore()
	require.NoError(t, secretStore.Store(localVaultKEKName, []byte("0123456789abcdef0123456789abcdef")))
	_, err := newLocalStore("relative/path", secretStore)
	require.Error(t, err)
	require.Contains(t, err.Error(), "must be absolute")

	shortSecretStore := newFixedTestSecretStore(map[string][]byte{
		localVaultKEKName: []byte("too-short"),
	})
	_, err = newLocalStore(t.TempDir(), shortSecretStore)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid local vault KEK length")
}

func TestLocalReadsAndWritesRemoteEnvelope(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	remoteSecret := []byte("fedcba9876543210fedcba9876543210")
	secretStore := NewMemorySecretStore()
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))
	remoteKEKName, err := remoteVaultKEKName("https://example.com/vault", testRemoteUserID)
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(remoteKEKName, remoteSecret))

	dek := []byte("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	plaintext, err := encodeState(newEmptyState())
	require.NoError(t, err)
	encryptedData, err := encryptXChaCha20Payload(plaintext, dek, "local vault payload")
	require.NoError(t, err)
	wrappedDEK, err := encryptXChaCha20Payload(dek, remoteSecret, "wrapped DEK")
	require.NoError(t, err)

	require.NoError(t, saveEnvelopeFile(dir, &Envelope{
		EncryptedData: encryptedData,
		WrappedDEK:    wrappedDEK,
		Remote: &RemoteState{
			RemoteURL:     "https://example.com/vault",
			UserID:        testRemoteUserID,
			CredentialID:  testRemoteCredentialID,
			LocalVersion:  7,
			RemoteVersion: 6,
			LastSyncTime:  1234,
			LastSyncError: "previous error",
		},
	}))

	ks, err := newLocalStore(dir, secretStore)
	require.NoError(t, err)

	keys, err := ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Empty(t, keys)

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	require.NoError(t, ks.StoreKey(ctx, "main", kp))

	envelope, err := load(dir)
	require.NoError(t, err)
	require.NotNil(t, envelope)
	require.NotNil(t, envelope.Remote)
	require.Equal(t, "https://example.com/vault", envelope.Remote.RemoteURL)
	require.Equal(t, 8, envelope.Remote.LocalVersion)
	require.Equal(t, 6, envelope.Remote.RemoteVersion)
	require.Equal(t, int64(1234), envelope.Remote.LastSyncTime)
	require.Equal(t, "previous error", envelope.Remote.LastSyncError)
}

func TestLocalRejectsUndecryptablePayload(t *testing.T) {
	dir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	secretStore := NewMemorySecretStore()
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	require.NoError(t, saveEnvelopeFile(dir, &Envelope{
		EncryptedData: []byte("short"),
		WrappedDEK:    mustWrapLocalTestDEK(t, keyMaterial),
	}))

	ks, err := newLocalStore(dir, secretStore)
	require.NoError(t, err)

	_, err = ks.ListKeys(context.Background())
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid local vault ciphertext")
}

func TestLocalRejectsWrongKeyForExisting(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	differentKeyMaterial := []byte("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	firstStore := NewMemorySecretStore()
	require.NoError(t, firstStore.Store(localVaultKEKName, keyMaterial))

	first, err := newLocalStore(dir, firstStore)
	require.NoError(t, err)

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	require.NoError(t, first.StoreKey(ctx, "main", kp))

	secondStore := NewMemorySecretStore()
	require.NoError(t, secondStore.Store(localVaultKEKName, differentKeyMaterial))
	second, err := newLocalStore(dir, secondStore)
	require.NoError(t, err)

	_, err = second.ListKeys(ctx)
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to decrypt wrapped DEK")
}

func TestLocalRejectsCorruptStatePayload(t *testing.T) {
	dir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	dek := []byte("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	secretStore := NewMemorySecretStore()
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	aead, err := chacha20poly1305.NewX(dek)
	require.NoError(t, err)

	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	_, err = rand.Read(nonce)
	require.NoError(t, err)

	ciphertext := aead.Seal(nil, nonce, []byte("not-a-gzip-payload"), nil)
	encryptedData := append(append([]byte(nil), nonce...), ciphertext...)

	require.NoError(t, saveEnvelopeFile(dir, &Envelope{
		EncryptedData: encryptedData,
		WrappedDEK:    mustWrapExplicitTestDEK(t, keyMaterial, dek),
	}))

	ks, err := newLocalStore(dir, secretStore)
	require.NoError(t, err)

	_, err = ks.ListKeys(context.Background())
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to decode local vault state")
}
