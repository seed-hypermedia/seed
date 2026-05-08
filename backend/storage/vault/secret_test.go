package vault

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zalando/go-keyring"
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

func TestOSKeychainSecretStoreLoadCachesSecret(t *testing.T) {
	backend := newTestKeyringStore()
	require.NoError(t, backend.Set(vaultKEKKeychainService, localVaultKEKName, base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x33}, vaultSecretSize))))
	store := newTestOSKeychainSecretStore(backend)

	first, err := store.Load(localVaultKEKName, "")
	require.NoError(t, err)
	second, err := store.Load(localVaultKEKName, "")
	require.NoError(t, err)

	first[0] ^= 0xff
	require.Equal(t, bytes.Repeat([]byte{0x33}, vaultSecretSize), second)
	require.Equal(t, 1, backend.getCalls)
}

func TestOSKeychainSecretStoreProvisionsLocalKEKWhenMissing(t *testing.T) {
	backend := newTestKeyringStore()
	store, err := newTestOSKeychainSecretStoreProvisioned(backend)
	require.NoError(t, err)

	require.Equal(t, 2, backend.getCalls)
	require.Equal(t, 1, backend.setCalls)

	loaded, err := store.Load(localVaultKEKName, "")
	require.NoError(t, err)
	require.Len(t, loaded, vaultSecretSize)
	// After provisioning, Load hits the in-memory cache — no extra keychain read.
	require.Equal(t, 2, backend.getCalls)

	// Keychain holds the same value as the cache.
	encoded, ok := backend.Secret(vaultKEKKeychainService, localVaultKEKName)
	require.True(t, ok)
	bundle, legacy, err := decodeSecretBundle(encoded)
	require.NoError(t, err)
	require.False(t, legacy)
	require.Equal(t, loaded, bundle.Credentials[""])
}

func TestOSKeychainSecretStoreCopiesLegacyLocalKEKToV2(t *testing.T) {
	backend := newTestKeyringStore()
	existing := bytes.Repeat([]byte{0x66}, vaultSecretSize)
	legacyEncoded := base64.StdEncoding.EncodeToString(existing)
	require.NoError(t, backend.Set(legacyVaultKEKKeychainService, localVaultKEKName, legacyEncoded))

	store, err := newTestOSKeychainSecretStoreProvisioned(backend)
	require.NoError(t, err)

	loaded, err := store.Load(localVaultKEKName, "")
	require.NoError(t, err)
	require.Equal(t, existing, loaded)
	legacyStored, ok := backend.Secret(legacyVaultKEKKeychainService, localVaultKEKName)
	require.True(t, ok)
	require.Equal(t, legacyEncoded, legacyStored)
	v2Stored, ok := backend.Secret(vaultKEKKeychainService, localVaultKEKName)
	require.True(t, ok)
	bundle, legacy, err := decodeSecretBundle(v2Stored)
	require.NoError(t, err)
	require.False(t, legacy)
	require.Equal(t, existing, bundle.Credentials[""])
}

func TestOSKeychainSecretStoreReusesExistingLocalKEK(t *testing.T) {
	backend := newTestKeyringStore()
	existing := bytes.Repeat([]byte{0x77}, vaultSecretSize)
	existingBundle, err := encodeSecretBundle(newSecretBundle("", existing))
	require.NoError(t, err)
	backend.Seed(vaultKEKKeychainService, localVaultKEKName, existingBundle)

	store, err := newTestOSKeychainSecretStoreProvisioned(backend)
	require.NoError(t, err)

	require.Equal(t, 1, backend.getCalls)
	require.Zero(t, backend.setCalls)

	loaded, err := store.Load(localVaultKEKName, "")
	require.NoError(t, err)
	require.Equal(t, existing, loaded)
}

func TestOSKeychainSecretStoreConcurrentProvisioningWritesOnce(t *testing.T) {
	const workers = 16

	backends := make([]*testKeyringStore, workers)
	var wg sync.WaitGroup
	errs := make(chan error, workers)

	for i := 0; i < workers; i++ {
		backends[i] = newTestKeyringStore()
		wg.Add(1)
		go func(b *testKeyringStore) {
			defer wg.Done()
			if _, err := newTestOSKeychainSecretStoreProvisioned(b); err != nil {
				errs <- err
			}
		}(backends[i])
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		require.NoError(t, err)
	}

	// Each independent backend must end up with exactly one keychain write.
	for _, b := range backends {
		require.Equal(t, 1, b.setCalls)
		require.Equal(t, 2, b.getCalls)
	}
}

func TestOSKeychainSecretStoreStoreUpdatesCache(t *testing.T) {
	backend := newTestKeyringStore()
	store := newTestOSKeychainSecretStore(backend)
	secret := bytes.Repeat([]byte{0x55}, vaultSecretSize)

	require.NoError(t, store.Store(localVaultKEKName, "", secret))

	loaded, err := store.Load(localVaultKEKName, "")
	require.NoError(t, err)
	require.Equal(t, secret, loaded)
	require.Equal(t, 2, backend.getCalls)
	require.Equal(t, 1, backend.setCalls)
}

func TestOSKeychainSecretStoreRejectsSecretOverwrite(t *testing.T) {
	backend := newTestKeyringStore()
	store := newTestOSKeychainSecretStore(backend)

	require.NoError(t, store.Store(localVaultKEKName, "", bytes.Repeat([]byte{0x11}, vaultSecretSize)))
	err := store.Store(localVaultKEKName, "", bytes.Repeat([]byte{0x22}, vaultSecretSize))
	require.Error(t, err)
	require.Contains(t, err.Error(), "already exists with different secret")
	require.Equal(t, 1, backend.setCalls)
}

func TestOSKeychainSecretStoreSecretBundle(t *testing.T) {
	backend := newTestKeyringStore()
	store := newTestOSKeychainSecretStore(backend)
	first := bytes.Repeat([]byte{0x11}, vaultSecretSize)
	second := bytes.Repeat([]byte{0x22}, vaultSecretSize)

	key, err := remoteVaultKEKName("https://example.com/vault", "user-123")
	require.NoError(t, err)
	require.NoError(t, store.Store(key, "cred-1", first))
	require.NoError(t, store.Store(key, "cred-2", second))

	loadedFirst, err := store.Load(key, "cred-1")
	require.NoError(t, err)
	loadedSecond, err := store.Load(key, "cred-2")
	require.NoError(t, err)
	require.Equal(t, first, loadedFirst)
	require.Equal(t, second, loadedSecond)
	credentialIDs, err := store.ListCredentialIDs(key)
	require.NoError(t, err)
	require.Equal(t, []string{"cred-1", "cred-2"}, credentialIDs)

	var stored secretBundle
	encoded, ok := backend.Secret(vaultKEKKeychainService, "https://example.com/vault|user-123")
	require.True(t, ok)
	require.NoError(t, json.Unmarshal([]byte(encoded), &stored))
	require.Equal(t, map[string][]byte{
		"cred-1": first,
		"cred-2": second,
	}, stored.Credentials)
}

func TestOSKeychainSecretStoreRejectsRemoteCredentialOverwrite(t *testing.T) {
	backend := newTestKeyringStore()
	store := newTestOSKeychainSecretStore(backend)

	key, err := remoteVaultKEKName("https://example.com/vault", "user-123")
	require.NoError(t, err)
	require.NoError(t, store.Store(key, "cred-1", bytes.Repeat([]byte{0x11}, vaultSecretSize)))
	err = store.Store(key, "cred-1", bytes.Repeat([]byte{0x22}, vaultSecretSize))
	require.Error(t, err)
	require.Contains(t, err.Error(), "already exists with different secret")
}

func TestDecodeSecretBundleDetectsLegacyRawSecret(t *testing.T) {
	secret := bytes.Repeat([]byte{0x11}, vaultSecretSize)
	bundle, legacy, err := decodeSecretBundle(base64.StdEncoding.EncodeToString(secret))
	require.NoError(t, err)
	require.True(t, legacy)
	require.Equal(t, secret, bundle.Credentials[""])
}

// TestOSKeychainSecretStoreLoadStoreRace verifies that a cache-miss Load
// racing with a conflicting Store preserves the existing keychain value.
func TestOSKeychainSecretStoreLoadStoreRacePreservesExistingSecret(t *testing.T) {
	const name = "remote|https://example.com|user"
	v1 := bytes.Repeat([]byte{0x01}, vaultSecretSize)
	v2 := bytes.Repeat([]byte{0x02}, vaultSecretSize)

	for i := 0; i < 200; i++ {
		backend := newTestKeyringStore()
		backend.Seed(vaultKEKKeychainService, name, base64.StdEncoding.EncodeToString(v1))
		store := newTestOSKeychainSecretStore(backend)

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = store.Load(name, "")
		}()
		go func() {
			defer wg.Done()
			_ = store.Store(name, "", v2)
		}()
		wg.Wait()

		// After both operations complete, cache and keychain must agree on v1.
		loaded, err := store.Load(name, "")
		require.NoError(t, err)
		require.Equal(t, v1, loaded, "iteration %d: cache diverged from keychain", i)
	}
}

type testKeyringStore struct {
	mu       sync.Mutex
	secrets  map[string]map[string]string
	getCalls int
	setCalls int
}

func newTestKeyringStore() *testKeyringStore {
	return &testKeyringStore{secrets: make(map[string]map[string]string)}
}

func newTestOSKeychainSecretStore(backend *testKeyringStore) *osKeychainSecretStore {
	return &osKeychainSecretStore{
		bundles:    make(map[string]secretBundle),
		legacyKeys: make(map[string]bool),
		get:        backend.Get,
		set:        backend.Set,
	}
}

func newTestOSKeychainSecretStoreProvisioned(backend *testKeyringStore) (*osKeychainSecretStore, error) {
	store := newTestOSKeychainSecretStore(backend)
	if err := store.ensureLocalKEK(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *testKeyringStore) Get(service string, user string) (string, error) {
	if service != vaultKEKKeychainService && service != legacyVaultKEKKeychainService {
		return "", fmt.Errorf("unexpected service %q", service)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.getCalls++

	secret, ok := s.secrets[service][user]
	if !ok {
		return "", keyring.ErrNotFound
	}
	return secret, nil
}

func (s *testKeyringStore) Set(service string, user string, password string) error {
	if service != vaultKEKKeychainService && service != legacyVaultKEKKeychainService {
		return fmt.Errorf("unexpected service %q", service)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.setCalls++
	if s.secrets[service] == nil {
		s.secrets[service] = make(map[string]string)
	}
	s.secrets[service][user] = password
	return nil
}

func (s *testKeyringStore) Seed(service string, user string, password string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.secrets[service] == nil {
		s.secrets[service] = make(map[string]string)
	}
	s.secrets[service][user] = password
}

func (s *testKeyringStore) Secret(service string, user string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	secret, ok := s.secrets[service][user]
	return secret, ok
}

func Example_decodeSecret() {
	secret, _ := decodeSecret(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x11}, vaultSecretSize)))
	fmt.Println(len(secret))
	// Output: 32
}
