package vault

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"seed/backend/core"

	"github.com/stretchr/testify/require"
)

type stubKeyStore struct {
	keys map[string]*core.KeyPair
}

func newStubKeyStore() *stubKeyStore {
	return &stubKeyStore{keys: make(map[string]*core.KeyPair)}
}

func (s *stubKeyStore) GetKey(_ context.Context, name string) (*core.KeyPair, error) {
	kp, ok := s.keys[name]
	if !ok {
		return nil, fmt.Errorf("missing key %q", name)
	}

	return kp, nil
}

func (s *stubKeyStore) StoreKey(_ context.Context, name string, kp *core.KeyPair) error {
	if _, exists := s.keys[name]; exists {
		return fmt.Errorf("duplicate key %q", name)
	}
	if kp == nil {
		return fmt.Errorf("nil keypair")
	}

	s.keys[name] = kp
	return nil
}

func (s *stubKeyStore) ListKeys(_ context.Context) ([]core.NamedKey, error) {
	names := make([]string, 0, len(s.keys))
	for name := range s.keys {
		names = append(names, name)
	}
	sort.Strings(names)

	out := make([]core.NamedKey, 0, len(names))
	for _, name := range names {
		out = append(out, core.NamedKey{Name: name, PublicKey: s.keys[name].PublicKey.Principal()})
	}

	return out, nil
}

func (s *stubKeyStore) ListKeyPairs(_ context.Context) ([]core.NamedKeyPair, error) {
	names := make([]string, 0, len(s.keys))
	for name := range s.keys {
		names = append(names, name)
	}
	sort.Strings(names)

	out := make([]core.NamedKeyPair, 0, len(names))
	for _, name := range names {
		out = append(out, core.NamedKeyPair{Name: name, KeyPair: s.keys[name]})
	}

	return out, nil
}

func (s *stubKeyStore) DeleteKey(_ context.Context, name string) error {
	delete(s.keys, name)
	return nil
}

func (s *stubKeyStore) DeleteAllKeys(_ context.Context) error {
	s.keys = make(map[string]*core.KeyPair)
	return nil
}

func (s *stubKeyStore) ChangeKeyName(_ context.Context, currentName, newName string) error {
	kp, ok := s.keys[currentName]
	if !ok {
		return fmt.Errorf("missing key %q", currentName)
	}
	delete(s.keys, currentName)
	s.keys[newName] = kp
	return nil
}

func TestNewProductionLoadsKeysAndMigratesLegacyKeys(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	legacy := newStubKeyStore()
	kp, err := core.GenerateKeyPair(core.Ed25519, bytes.NewReader(bytes.Repeat([]byte{0x42}, 64)))
	require.NoError(t, err)
	require.NoError(t, legacy.StoreKey(ctx, "alice", kp))

	localKey := bytes.Repeat([]byte{0x11}, 32)
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, localKey))

	ks, err := openProduction(dataDir, legacy, secretStore)
	require.NoError(t, err)

	storedKey, err := ks.GetKey(ctx, "alice")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), storedKey.Principal())

	legacyKey, err := legacy.GetKey(ctx, "alice")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), legacyKey.Principal())

	start, err := ks.StartConnection("https://vault.example.com", false)
	require.NoError(t, err)
	require.Equal(t, "https://vault.example.com", start.RemoteURL)
	_, err = base64.RawURLEncoding.DecodeString(start.HandoffToken)
	require.NoError(t, err)
}

func TestNewProductionReturnsSecretLoaderError(t *testing.T) {
	_, err := openProduction(t.TempDir(), nil, boomSecretStore{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to load local vault KEK")
	require.Contains(t, err.Error(), "boom")
}

func TestNewProductionRejectsSecondInitializationInProcess(t *testing.T) {
	productionVaultInitialized.Store(true)
	t.Cleanup(func() {
		productionVaultInitialized.Store(false)
	})

	_, err := NewProduction(t.TempDir(), "test")
	require.ErrorIs(t, err, errProductionVaultAlreadyInitialized)
}

func TestNewProductionSkipsLegacyMigrationWhenLocalVaultExists(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	localKey := bytes.Repeat([]byte{0x33}, 32)
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, localKey))

	existingLocal, err := New(dataDir, secretStore)
	require.NoError(t, err)
	localOnlyKey, err := core.GenerateKeyPair(core.Ed25519, bytes.NewReader(bytes.Repeat([]byte{0x21}, 64)))
	require.NoError(t, err)
	require.NoError(t, existingLocal.StoreKey(ctx, "local-only", localOnlyKey))

	legacy := newStubKeyStore()
	legacyKey, err := core.GenerateKeyPair(core.Ed25519, bytes.NewReader(bytes.Repeat([]byte{0x44}, 64)))
	require.NoError(t, err)
	require.NoError(t, legacy.StoreKey(ctx, "legacy", legacyKey))

	ks, err := openProduction(dataDir, legacy, secretStore)
	require.NoError(t, err)

	gotLocalOnly, err := ks.GetKey(ctx, "local-only")
	require.NoError(t, err)
	require.Equal(t, localOnlyKey.Principal(), gotLocalOnly.Principal())

	_, err = ks.GetKey(ctx, "legacy")
	require.Error(t, err)
	require.ErrorContains(t, err, "legacy")

	gotLegacy, err := legacy.GetKey(ctx, "legacy")
	require.NoError(t, err)
	require.Equal(t, legacyKey.Principal(), gotLegacy.Principal())
}

func TestMigrateLegacyKeySnapshotDoesNotWritePartialVaultFile(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, bytes.Repeat([]byte{0x55}, 32)))

	ks, err := New(dataDir, secretStore)
	require.NoError(t, err)
	firstKey, err := core.GenerateKeyPair(core.Ed25519, bytes.NewReader(bytes.Repeat([]byte{0x12}, 64)))
	require.NoError(t, err)
	firstBinary, err := firstKey.MarshalBinary()
	require.NoError(t, err)

	err = ks.migrateLegacyKeySnapshot(ctx, map[string][]byte{
		"alice": firstBinary,
		"bob":   []byte("not-a-keypair"),
	})
	require.Error(t, err)
	require.ErrorContains(t, err, `failed decoding legacy key "bob"`)

	_, statErr := os.Stat(filepath.Join(dataDir, fileName))
	require.ErrorIs(t, statErr, os.ErrNotExist)

	keys, err := ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Empty(t, keys)
}

type boomSecretStore struct{}

func (boomSecretStore) Load(string) ([]byte, error) { return nil, fmt.Errorf("boom") }
func (boomSecretStore) Store(string, []byte) error  { return fmt.Errorf("boom") }
func (boomSecretStore) Delete(string) error         { return fmt.Errorf("boom") }
