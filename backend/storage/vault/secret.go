package vault

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"
	"golang.org/x/crypto/hkdf"
)

const (
	vaultKEKKeychainService = "seed-hypermedia-vault-secret"
	localVaultKEKName       = "local"
	vaultSecretSize         = 32
	remoteAuthKeyInfo       = "seed-hypermedia-vault-secret-authentication"
)

// SecretStore stores vault secrets by name. Implementations guarantee that
// the local KEK (localVaultKEKName) is present by the time a successful
// constructor returns; callers can rely on Load(localVaultKEKName) succeeding
// without any prior Store. Values under a given name are meant to be
// immutable for the lifetime of the store — callers rotate by Delete + Store.
type SecretStore interface {
	Load(name string) ([]byte, error)
	Store(name string, secret []byte) error
	Delete(name string) error
}

type memorySecretStore struct {
	mu      sync.Mutex
	secrets map[string][]byte
}

type osKeychainSecretStore struct {
	mu      sync.RWMutex
	secrets map[string][]byte
	get     func(service string, user string) (string, error)
	set     func(service string, user string, password string) error
	remove  func(service string, user string) error
}

// newOSKeychainSecretStore returns an OS-keychain-backed secret store with an
// in-memory cache. The local KEK is loaded from the keychain or
// auto-generated on first use so that Load(localVaultKEKName) is always
// satisfied after this function returns without error.
func newOSKeychainSecretStore() (SecretStore, error) {
	s := &osKeychainSecretStore{
		secrets: make(map[string][]byte),
		get:     keyring.Get,
		set:     keyring.Set,
		remove:  keyring.Delete,
	}
	if err := s.ensureLocalKEK(); err != nil {
		return nil, err
	}
	return s, nil
}

// NewMemorySecretStore returns an in-memory secret store with a freshly
// generated local KEK.
func NewMemorySecretStore() (SecretStore, error) {
	secret, err := newRandomSecret()
	if err != nil {
		return nil, err
	}
	return &memorySecretStore{
		secrets: map[string][]byte{localVaultKEKName: secret},
	}, nil
}

func (s *memorySecretStore) Load(name string) ([]byte, error) {
	key, err := normalizeKEKName(name)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	secret, ok := s.secrets[key]
	if !ok {
		return nil, fmt.Errorf("vault KEK not found for %s", key)
	}
	return slices.Clone(secret), nil
}

func (s *memorySecretStore) Store(name string, secret []byte) error {
	key, err := normalizeKEKName(name)
	if err != nil {
		return err
	}
	if len(secret) != vaultSecretSize {
		return fmt.Errorf("invalid vault KEK length: got %d bytes", len(secret))
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.secrets[key] = slices.Clone(secret)
	return nil
}

func (s *memorySecretStore) Delete(name string) error {
	key, err := normalizeKEKName(name)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.secrets, key)
	return nil
}

func (s *osKeychainSecretStore) Load(name string) ([]byte, error) {
	account, err := normalizeKEKName(name)
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	if secret, ok := s.secrets[account]; ok {
		secret = slices.Clone(secret)
		s.mu.RUnlock()
		return secret, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()

	// Double-check under the write lock: a concurrent Store/Load may have
	// populated the cache while we were re-acquiring, and if we skipped
	// this check we could overwrite a fresh value with a stale keychain
	// read.
	if secret, ok := s.secrets[account]; ok {
		return slices.Clone(secret), nil
	}

	encoded, err := s.get(vaultKEKKeychainService, account)
	if err != nil {
		return nil, fmt.Errorf("failed reading vault KEK from keyring: %w", err)
	}

	secret, err := decodeSecret(encoded)
	if err != nil {
		return nil, err
	}

	s.secrets[account] = secret
	return slices.Clone(secret), nil
}

func (s *osKeychainSecretStore) Store(name string, secret []byte) error {
	account, err := normalizeKEKName(name)
	if err != nil {
		return err
	}
	if len(secret) != vaultSecretSize {
		return fmt.Errorf("invalid vault KEK length: got %d bytes", len(secret))
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.set(vaultKEKKeychainService, account, base64.StdEncoding.EncodeToString(secret)); err != nil {
		return fmt.Errorf("failed storing vault KEK in keyring: %w", err)
	}
	s.secrets[account] = slices.Clone(secret)
	return nil
}

func (s *osKeychainSecretStore) Delete(name string) error {
	account, err := normalizeKEKName(name)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.remove(vaultKEKKeychainService, account); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return fmt.Errorf("failed deleting vault KEK from keyring: %w", err)
	}
	delete(s.secrets, account)
	return nil
}

// ensureLocalKEK seeds localVaultKEKName from the keychain, generating and
// storing a fresh secret if none exists. Called once at construction.
func (s *osKeychainSecretStore) ensureLocalKEK() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	encoded, err := s.get(vaultKEKKeychainService, localVaultKEKName)
	switch {
	case err == nil:
		secret, err := decodeSecret(encoded)
		if err != nil {
			return err
		}
		s.secrets[localVaultKEKName] = secret
		return nil
	case !errors.Is(err, keyring.ErrNotFound):
		return fmt.Errorf("failed reading vault KEK from keyring: %w", err)
	}

	secret, err := newRandomSecret()
	if err != nil {
		return err
	}
	if err := s.set(vaultKEKKeychainService, localVaultKEKName, base64.StdEncoding.EncodeToString(secret)); err != nil {
		return fmt.Errorf("failed storing vault KEK in keyring: %w", err)
	}
	s.secrets[localVaultKEKName] = secret
	return nil
}

func normalizeKEKName(name string) (string, error) {
	normalized := strings.TrimSpace(name)
	if normalized == "" {
		return "", fmt.Errorf("vault KEK name is required")
	}

	return normalized, nil
}

func remoteVaultKEKName(remoteURL string, userID string) (string, error) {
	normalizedURL := strings.TrimSpace(remoteURL)
	if normalizedURL == "" {
		return "", fmt.Errorf("remote vault URL is required")
	}

	normalizedUserID := strings.TrimSpace(userID)
	if normalizedUserID == "" {
		return "", fmt.Errorf("remote vault user ID is required")
	}

	return normalizedURL + "|" + normalizedUserID, nil
}

func newRandomSecret() ([]byte, error) {
	secret := make([]byte, vaultSecretSize)
	if _, err := io.ReadFull(rand.Reader, secret); err != nil {
		return nil, fmt.Errorf("failed generating vault secret: %w", err)
	}

	return secret, nil
}

func decodeSecret(encoded string) ([]byte, error) {
	secret, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("failed decoding vault secret from keyring: %w", err)
	}
	if len(secret) != vaultSecretSize {
		return nil, fmt.Errorf("invalid vault secret length: got %d bytes", len(secret))
	}

	return secret, nil
}

func deriveRemoteAuthKey(secret []byte) ([]byte, error) {
	if len(secret) != vaultSecretSize {
		return nil, fmt.Errorf("invalid vault secret length: got %d bytes", len(secret))
	}

	authKey := make([]byte, vaultSecretSize)
	reader := hkdf.New(sha256.New, secret, nil, []byte(remoteAuthKeyInfo))
	if _, err := io.ReadFull(reader, authKey); err != nil {
		return nil, fmt.Errorf("failed deriving remote auth key: %w", err)
	}

	return authKey, nil
}
