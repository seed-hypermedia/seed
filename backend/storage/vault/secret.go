package vault

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"
	"golang.org/x/crypto/hkdf"
)

const (
	legacyVaultKEKKeychainService = "seed-hypermedia-vault-secret"
	vaultKEKKeychainService       = "seed-hypermedia-vault-secret-v2"
	localVaultKEKName             = "local"
	vaultSecretSize               = 32
	remoteAuthKeyInfo             = "seed-hypermedia-vault-secret-authentication"
)

// SecretStore stores vault secrets by name. Implementations guarantee that
// the local KEK with key "local" is present by the time a successful
// constructor returns; callers can rely on Load("local", "") succeeding
// without any prior Store.
type SecretStore interface {
	Load(key string, credentialID string) ([]byte, error)
	Store(key string, credentialID string, secret []byte) error
	ListCredentialIDs(key string) ([]string, error)
}

type memorySecretStore struct {
	mu      sync.Mutex
	bundles map[string]secretBundle
}

type osKeychainSecretStore struct {
	mu         sync.RWMutex
	bundles    map[string]secretBundle
	legacyKeys map[string]bool
	get        func(service string, user string) (string, error)
	set        func(service string, user string, password string) error
}

// secretBundle is a keychain secret bundle keyed by credential ID.
type secretBundle struct {
	Credentials map[string][]byte `json:"credentials"`
}

var (
	errLegacyRemoteCredentialRecord = errors.New("legacy remote credential record")
	// ErrRemoteCredentialNotFound reports that a remote credential bundle does not contain the requested credential.
	ErrRemoteCredentialNotFound = errors.New("remote credential not found")
)

// newOSKeychainSecretStore returns an OS-keychain-backed secret store with an
// in-memory cache. The local KEK is loaded from the keychain or
// auto-generated on first use so that Load(localVaultKEKName, "") is always
// satisfied after this function returns without error.
func newOSKeychainSecretStore() (SecretStore, error) {
	s := &osKeychainSecretStore{
		bundles:    make(map[string]secretBundle),
		legacyKeys: make(map[string]bool),
		get:        keyring.Get,
		set:        keyring.Set,
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
		bundles: map[string]secretBundle{
			localVaultKEKName: newSecretBundle("", secret),
		},
	}, nil
}

func (s *memorySecretStore) Load(key string, credentialID string) ([]byte, error) {
	key, err := normalizeKEKName(key)
	if err != nil {
		return nil, err
	}
	credentialID = strings.TrimSpace(credentialID)

	s.mu.Lock()
	defer s.mu.Unlock()

	bundle, ok := s.bundles[key]
	if !ok {
		return nil, fmt.Errorf("vault credential bundle not found for %s: %w", key, keyring.ErrNotFound)
	}
	secret, ok := bundle.Credentials[credentialID]
	if !ok {
		return nil, credentialNotFoundError(credentialID)
	}
	return slices.Clone(secret), nil
}

func (s *memorySecretStore) Store(key string, credentialID string, secret []byte) error {
	key, err := normalizeKEKName(key)
	if err != nil {
		return err
	}
	if len(secret) != vaultSecretSize {
		return fmt.Errorf("invalid vault KEK length: got %d bytes", len(secret))
	}
	credentialID = strings.TrimSpace(credentialID)

	s.mu.Lock()
	defer s.mu.Unlock()

	return s.storeCredentialLocked(key, credentialID, secret)
}

func (s *memorySecretStore) ListCredentialIDs(key string) ([]string, error) {
	key, err := normalizeKEKName(key)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	bundle, ok := s.bundles[key]
	if !ok {
		return nil, fmt.Errorf("vault credential bundle not found for %s: %w", key, keyring.ErrNotFound)
	}

	return sortedCredentialIDs(bundle), nil
}

func (s *memorySecretStore) storeCredentialLocked(key string, credentialID string, secret []byte) error {
	if key == localVaultKEKName && credentialID == "" {
		s.bundles[key] = newSecretBundle(credentialID, secret)
		return nil
	}

	bundle := s.bundles[key]
	if bundle.Credentials == nil {
		bundle = secretBundle{Credentials: make(map[string][]byte)}
		s.bundles[key] = bundle
	}
	if existing, ok := bundle.Credentials[credentialID]; ok {
		if !slices.Equal(existing, secret) {
			return fmt.Errorf("vault credential %q for %q already exists with different secret", credentialID, key)
		}
		return nil
	}
	bundle.Credentials[credentialID] = slices.Clone(secret)
	return nil
}

func (s *osKeychainSecretStore) Load(key string, credentialID string) ([]byte, error) {
	account, err := normalizeKEKName(key)
	if err != nil {
		return nil, err
	}
	credentialID = strings.TrimSpace(credentialID)

	s.mu.RLock()
	if bundle, ok := s.bundles[account]; ok {
		secret, ok := bundle.Credentials[credentialID]
		if !ok {
			s.mu.RUnlock()
			return nil, credentialNotFoundError(credentialID)
		}
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
	if bundle, ok := s.bundles[account]; ok {
		secret, ok := bundle.Credentials[credentialID]
		if !ok {
			return nil, credentialNotFoundError(credentialID)
		}
		return slices.Clone(secret), nil
	}

	bundle, legacy, err := s.loadBundleFromKeyringLocked(account)
	if err != nil {
		return nil, err
	}
	if legacy && credentialID != "" {
		return nil, errLegacyRemoteCredentialRecord
	}

	secret, ok := bundle.Credentials[credentialID]
	if !ok {
		return nil, credentialNotFoundError(credentialID)
	}

	if !legacy || account == localVaultKEKName {
		s.bundles[account] = bundle
		s.legacyKeys[account] = legacy
	}
	return slices.Clone(secret), nil
}

func (s *osKeychainSecretStore) Store(key string, credentialID string, secret []byte) error {
	account, err := normalizeKEKName(key)
	if err != nil {
		return err
	}
	if len(secret) != vaultSecretSize {
		return fmt.Errorf("invalid vault KEK length: got %d bytes", len(secret))
	}
	credentialID = strings.TrimSpace(credentialID)

	s.mu.Lock()
	defer s.mu.Unlock()

	bundle, ok := s.bundles[account]
	if !ok {
		var err error
		var legacy bool
		bundle, legacy, err = s.loadBundleFromKeyringLocked(account)
		if err != nil {
			if errors.Is(err, keyring.ErrNotFound) {
				bundle = secretBundle{Credentials: make(map[string][]byte)}
			} else {
				return err
			}
		}
		if legacy && credentialID != "" {
			bundle = secretBundle{Credentials: make(map[string][]byte)}
		}
	}

	changed, err := storeCredentialInBundle(&bundle, account, credentialID, secret)
	if err != nil {
		return err
	}
	if s.legacyKeys[account] {
		changed = true
	}
	if !changed {
		s.bundles[account] = bundle
		return nil
	}
	encoded, err := encodeSecretBundle(bundle)
	if err != nil {
		return err
	}
	if err := s.set(vaultKEKKeychainService, account, encoded); err != nil {
		return fmt.Errorf("failed storing vault credentials in keyring: %w", err)
	}
	s.bundles[account] = bundle
	delete(s.legacyKeys, account)
	return nil
}

func (s *osKeychainSecretStore) ListCredentialIDs(key string) ([]string, error) {
	account, err := normalizeKEKName(key)
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	if bundle, ok := s.bundles[account]; ok {
		s.mu.RUnlock()
		return sortedCredentialIDs(bundle), nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()

	if bundle, ok := s.bundles[account]; ok {
		return sortedCredentialIDs(bundle), nil
	}

	bundle, legacy, err := s.loadBundleFromKeyringLocked(account)
	if err != nil {
		return nil, err
	}
	if legacy {
		return nil, errLegacyRemoteCredentialRecord
	}
	s.bundles[account] = bundle
	delete(s.legacyKeys, account)

	return sortedCredentialIDs(bundle), nil
}

// ensureLocalKEK seeds localVaultKEKName from the keychain, generating and
// storing a fresh secret if none exists. Called once at construction.
// Legacy raw local records are copied into the v2 keychain namespace so older
// production builds can keep reading the original record.
func (s *osKeychainSecretStore) ensureLocalKEK() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bundle, legacy, err := s.loadBundleFromKeyringLocked(localVaultKEKName)
	switch {
	case err == nil:
		if _, ok := bundle.Credentials[""]; !ok {
			return fmt.Errorf("local vault KEK not found in keychain bundle")
		}
		if legacy {
			encoded, err := encodeSecretBundle(bundle)
			if err != nil {
				return err
			}
			if err := s.set(vaultKEKKeychainService, localVaultKEKName, encoded); err != nil {
				return fmt.Errorf("failed storing vault KEK in keyring: %w", err)
			}
			legacy = false
		}
		s.bundles[localVaultKEKName] = bundle
		s.legacyKeys[localVaultKEKName] = legacy
		return nil
	case !errors.Is(err, keyring.ErrNotFound):
		return err
	}

	secret, err := newRandomSecret()
	if err != nil {
		return err
	}
	bundle = newSecretBundle("", secret)
	encoded, err := encodeSecretBundle(bundle)
	if err != nil {
		return err
	}
	if err := s.set(vaultKEKKeychainService, localVaultKEKName, encoded); err != nil {
		return fmt.Errorf("failed storing vault KEK in keyring: %w", err)
	}
	s.bundles[localVaultKEKName] = bundle
	delete(s.legacyKeys, localVaultKEKName)
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

func (s *osKeychainSecretStore) loadBundleFromKeyringLocked(account string) (secretBundle, bool, error) {
	encoded, err := s.get(vaultKEKKeychainService, account)
	if err != nil {
		if !errors.Is(err, keyring.ErrNotFound) {
			return secretBundle{}, false, fmt.Errorf("failed reading vault credentials from keyring: %w", err)
		}

		legacyEncoded, legacyErr := s.get(legacyVaultKEKKeychainService, account)
		if legacyErr != nil {
			if errors.Is(legacyErr, keyring.ErrNotFound) {
				return secretBundle{}, false, fmt.Errorf("failed reading vault credentials from keyring: %w", err)
			}
			return secretBundle{}, false, fmt.Errorf("failed reading legacy vault credentials from keyring: %w", legacyErr)
		}
		legacySecret, legacyDecodeErr := decodeSecret(legacyEncoded)
		if legacyDecodeErr != nil {
			return secretBundle{}, false, legacyDecodeErr
		}
		return newSecretBundle("", legacySecret), true, nil
	}

	bundle, legacy, err := decodeSecretBundle(encoded)
	if err != nil {
		return secretBundle{}, false, err
	}
	return bundle, legacy, nil
}

func decodeSecretBundle(encoded string) (bundle secretBundle, legacy bool, err error) {
	if err := json.Unmarshal([]byte(encoded), &bundle); err != nil || bundle.Credentials == nil {
		legacySecret, decodeErr := decodeSecret(encoded)
		if decodeErr == nil {
			return newSecretBundle("", legacySecret), true, nil
		}
		if err != nil {
			return secretBundle{}, false, fmt.Errorf("failed decoding vault credential bundle: %w", err)
		}
		return secretBundle{}, false, fmt.Errorf("vault credential bundle must contain credentials")
	}

	for credentialID, secret := range bundle.Credentials {
		if strings.TrimSpace(credentialID) == "" {
			if credentialID != "" {
				return secretBundle{}, false, fmt.Errorf("vault credential bundle contains blank credential ID")
			}
		}
		if len(secret) != vaultSecretSize {
			return secretBundle{}, false, fmt.Errorf("invalid vault secret length: got %d bytes", len(secret))
		}
	}

	return bundle, false, nil
}

func encodeSecretBundle(bundle secretBundle) (string, error) {
	if bundle.Credentials == nil {
		bundle.Credentials = make(map[string][]byte)
	}
	data, err := json.Marshal(bundle)
	if err != nil {
		return "", fmt.Errorf("failed encoding vault credential bundle: %w", err)
	}

	return string(data), nil
}

func newSecretBundle(credentialID string, secret []byte) secretBundle {
	return secretBundle{Credentials: map[string][]byte{
		credentialID: slices.Clone(secret),
	}}
}

func storeCredentialInBundle(bundle *secretBundle, key string, credentialID string, secret []byte) (bool, error) {
	if bundle.Credentials == nil {
		bundle.Credentials = make(map[string][]byte)
	}
	if existing, ok := bundle.Credentials[credentialID]; ok {
		if !slices.Equal(existing, secret) {
			return false, fmt.Errorf("vault credential %q for %q already exists with different secret", credentialID, key)
		}
		return false, nil
	}
	bundle.Credentials[credentialID] = slices.Clone(secret)
	return true, nil
}

func credentialNotFoundError(credentialID string) error {
	if credentialID == "" {
		return fmt.Errorf("vault KEK not found")
	}
	return fmt.Errorf("%w: %q", ErrRemoteCredentialNotFound, credentialID)
}

func sortedCredentialIDs(bundle secretBundle) []string {
	ids := make([]string, 0, len(bundle.Credentials))
	for credentialID := range bundle.Credentials {
		ids = append(ids, credentialID)
	}
	sort.Strings(ids)
	return ids
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
