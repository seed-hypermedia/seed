package vault

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
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

// SecretStore stores vault secrets by name.
type SecretStore interface {
	Load(name string) ([]byte, error)
	Ensure(name string) ([]byte, error)
	Store(name string, secret []byte) error
	Delete(name string) error
}

type memorySecretStore struct {
	mu      sync.Mutex
	secrets map[string][]byte
}

type osKeychainSecretStore struct{}

// NewOSKeychainSecretStore returns the shared OS-keychain-backed secret store.
func NewOSKeychainSecretStore() (SecretStore, error) {
	return osKeychainSecretStore{}, nil
}

// NewMemorySecretStore returns an in-memory secret store.
func NewMemorySecretStore() SecretStore {
	return &memorySecretStore{
		secrets: make(map[string][]byte),
	}
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
	return append([]byte(nil), secret...), nil
}

func (s *memorySecretStore) Ensure(name string) ([]byte, error) {
	key, err := normalizeKEKName(name)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if secret, ok := s.secrets[key]; ok {
		return append([]byte(nil), secret...), nil
	}

	secret, err := newRandomSecret()
	if err != nil {
		return nil, err
	}
	s.secrets[key] = append([]byte(nil), secret...)
	return append([]byte(nil), secret...), nil
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
	s.secrets[key] = append([]byte(nil), secret...)
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

func (s osKeychainSecretStore) Load(name string) ([]byte, error) {
	account, err := normalizeKEKName(name)
	if err != nil {
		return nil, err
	}

	encoded, err := keyring.Get(vaultKEKKeychainService, account)
	if err != nil {
		return nil, fmt.Errorf("failed reading vault KEK from keyring: %w", err)
	}

	return decodeSecret(encoded)
}

func (s osKeychainSecretStore) Ensure(name string) ([]byte, error) {
	account, err := normalizeKEKName(name)
	if err != nil {
		return nil, err
	}

	encoded, err := keyring.Get(vaultKEKKeychainService, account)
	switch {
	case err == nil:
		return decodeSecret(encoded)
	case !errors.Is(err, keyring.ErrNotFound):
		return nil, fmt.Errorf("failed reading vault KEK from keyring: %w", err)
	}

	secret, err := newRandomSecret()
	if err != nil {
		return nil, err
	}
	if err := keyring.Set(vaultKEKKeychainService, account, base64.StdEncoding.EncodeToString(secret)); err != nil {
		return nil, fmt.Errorf("failed storing vault KEK in keyring: %w", err)
	}

	return append([]byte(nil), secret...), nil
}

func (s osKeychainSecretStore) Store(name string, secret []byte) error {
	account, err := normalizeKEKName(name)
	if err != nil {
		return err
	}
	if len(secret) != vaultSecretSize {
		return fmt.Errorf("invalid vault KEK length: got %d bytes", len(secret))
	}

	if err := keyring.Set(vaultKEKKeychainService, account, base64.StdEncoding.EncodeToString(secret)); err != nil {
		return fmt.Errorf("failed storing vault KEK in keyring: %w", err)
	}
	return nil
}

func (s osKeychainSecretStore) Delete(name string) error {
	account, err := normalizeKEKName(name)
	if err != nil {
		return err
	}

	if err := keyring.Delete(vaultKEKKeychainService, account); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return fmt.Errorf("failed deleting vault KEK from keyring: %w", err)
	}
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
