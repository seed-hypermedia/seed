package vault

import (
	"bytes"
	"encoding/base64"
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
	backend.secrets[localVaultKEKName] = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x33}, vaultSecretSize))
	store := newTestOSKeychainSecretStore(backend)

	first, err := store.Load(localVaultKEKName)
	require.NoError(t, err)
	second, err := store.Load(localVaultKEKName)
	require.NoError(t, err)

	first[0] ^= 0xff
	require.Equal(t, bytes.Repeat([]byte{0x33}, vaultSecretSize), second)
	require.Equal(t, 1, backend.getCalls)
}

func TestOSKeychainSecretStoreProvisionsLocalKEKWhenMissing(t *testing.T) {
	backend := newTestKeyringStore()
	store, err := newTestOSKeychainSecretStoreProvisioned(backend)
	require.NoError(t, err)

	require.Equal(t, 1, backend.getCalls)
	require.Equal(t, 1, backend.setCalls)

	loaded, err := store.Load(localVaultKEKName)
	require.NoError(t, err)
	require.Len(t, loaded, vaultSecretSize)
	// After provisioning, Load hits the in-memory cache — no extra keychain read.
	require.Equal(t, 1, backend.getCalls)

	// Keychain holds the same value as the cache.
	encoded, ok := backend.secrets[localVaultKEKName]
	require.True(t, ok)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)
	require.Equal(t, decoded, loaded)
}

func TestOSKeychainSecretStoreReusesExistingLocalKEK(t *testing.T) {
	backend := newTestKeyringStore()
	existing := bytes.Repeat([]byte{0x77}, vaultSecretSize)
	backend.secrets[localVaultKEKName] = base64.StdEncoding.EncodeToString(existing)

	store, err := newTestOSKeychainSecretStoreProvisioned(backend)
	require.NoError(t, err)

	require.Equal(t, 1, backend.getCalls)
	require.Zero(t, backend.setCalls)

	loaded, err := store.Load(localVaultKEKName)
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
		require.Equal(t, 1, b.getCalls)
	}
}

func TestOSKeychainSecretStoreStoreAndDeleteUpdateCache(t *testing.T) {
	backend := newTestKeyringStore()
	store := newTestOSKeychainSecretStore(backend)
	secret := bytes.Repeat([]byte{0x55}, vaultSecretSize)

	require.NoError(t, store.Store(localVaultKEKName, secret))

	loaded, err := store.Load(localVaultKEKName)
	require.NoError(t, err)
	require.Equal(t, secret, loaded)
	require.Zero(t, backend.getCalls)
	require.Equal(t, 1, backend.setCalls)

	require.NoError(t, store.Delete(localVaultKEKName))
	_, err = store.Load(localVaultKEKName)
	require.Error(t, err)
	require.Equal(t, 1, backend.deleteCalls)
	require.Equal(t, 1, backend.getCalls)
}

// TestOSKeychainSecretStoreLoadStoreRace is a regression for a race where a
// cache-miss Load that started before a concurrent Store could race with the
// Store and leave the cache holding the pre-Store value even after Store had
// already updated both keychain and cache.
func TestOSKeychainSecretStoreLoadStoreRace(t *testing.T) {
	const name = "remote|https://example.com|user"
	v1 := bytes.Repeat([]byte{0x01}, vaultSecretSize)
	v2 := bytes.Repeat([]byte{0x02}, vaultSecretSize)

	for i := 0; i < 200; i++ {
		backend := newTestKeyringStore()
		require.NoError(t, backend.Set(vaultKEKKeychainService, name, base64.StdEncoding.EncodeToString(v1)))
		store := newTestOSKeychainSecretStore(backend)

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = store.Load(name)
		}()
		go func() {
			defer wg.Done()
			_ = store.Store(name, v2)
		}()
		wg.Wait()

		// After both operations complete, cache and keychain must agree on v2.
		loaded, err := store.Load(name)
		require.NoError(t, err)
		require.Equal(t, v2, loaded, "iteration %d: cache diverged from keychain", i)
	}
}

type testKeyringStore struct {
	mu          sync.Mutex
	secrets     map[string]string
	getCalls    int
	setCalls    int
	deleteCalls int
}

func newTestKeyringStore() *testKeyringStore {
	return &testKeyringStore{secrets: make(map[string]string)}
}

func newTestOSKeychainSecretStore(backend *testKeyringStore) *osKeychainSecretStore {
	return &osKeychainSecretStore{
		secrets: make(map[string][]byte),
		get:     backend.Get,
		set:     backend.Set,
		remove:  backend.Delete,
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
	if service != vaultKEKKeychainService {
		return "", fmt.Errorf("unexpected service %q", service)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.getCalls++

	secret, ok := s.secrets[user]
	if !ok {
		return "", keyring.ErrNotFound
	}
	return secret, nil
}

func (s *testKeyringStore) Set(service string, user string, password string) error {
	if service != vaultKEKKeychainService {
		return fmt.Errorf("unexpected service %q", service)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.setCalls++
	s.secrets[user] = password
	return nil
}

func (s *testKeyringStore) Delete(service string, user string) error {
	if service != vaultKEKKeychainService {
		return fmt.Errorf("unexpected service %q", service)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleteCalls++
	delete(s.secrets, user)
	return nil
}

func Example_decodeSecret() {
	secret, _ := decodeSecret(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x11}, vaultSecretSize)))
	fmt.Println(len(secret))
	// Output: 32
}
