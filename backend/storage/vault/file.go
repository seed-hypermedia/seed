// Package vault implements the encrypted local vault file and optional remote sync state.
package vault

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"seed/backend/util/atomicfile"

	"golang.org/x/crypto/chacha20poly1305"
)

const fileName = "vault.json"

// Envelope is the on-disk vault envelope.
type Envelope struct {
	EncryptedData []byte       `json:"encryptedData"`
	WrappedDEK    []byte       `json:"wrappedDEK"`
	Credentials   []Credential `json:"credentials,omitempty"`
	Remote        *RemoteState `json:"remote,omitempty"`
}

// RemoteState stores remote vault connection, version, and last-sync metadata in the envelope.
type RemoteState struct {
	RemoteURL          string `json:"vaultUrl"`
	UserID             string `json:"userId"`
	CredentialID       string `json:"credentialId"`
	LocalVersion       int    `json:"localVersion,omitempty"`
	RemoteVersion      int    `json:"remoteVersion,omitempty"`
	SyncedLocalVersion int    `json:"syncedLocalVersion,omitempty"`
	LastSyncTime       int64  `json:"lastSyncTime,omitempty"`
	LastSyncError      string `json:"lastSyncError,omitempty"`
}

// load loads the vault envelope from <data-dir>/vault.json.
func load(dataDir string) (*Envelope, error) {
	data, err := os.ReadFile(filepath.Join(dataDir, fileName))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, fmt.Errorf("failed to decode vault envelope: %w", err)
	}

	if err := envelope.validate(); err != nil {
		return nil, err
	}

	return &envelope, nil
}

// saveEnvelopeFile saves the vault envelope to <data-dir>/vault.json.
func saveEnvelopeFile(dataDir string, envelope *Envelope) error {
	if err := envelope.validate(); err != nil {
		return err
	}

	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode vault envelope: %w", err)
	}

	return atomicfile.WriteFile(filepath.Join(dataDir, fileName), data, 0600)
}

func (envelope *Envelope) validate() error {
	if envelope == nil {
		return fmt.Errorf("vault envelope is required")
	}
	if len(envelope.EncryptedData) == 0 {
		return fmt.Errorf("vault encrypted data must not be empty")
	}
	if len(envelope.WrappedDEK) == 0 {
		return fmt.Errorf("vault wrapped DEK must not be empty")
	}
	if envelope.Remote != nil && envelope.Remote.RemoteURL == "" {
		return fmt.Errorf("remote vault URL is required")
	}
	if envelope.Remote != nil && envelope.Remote.UserID == "" {
		return fmt.Errorf("remote vault user ID is required")
	}

	return nil
}

type fileStore struct {
	dataDir     string
	secretStore SecretStore
}

type vaultSnapshot struct {
	Envelope *Envelope
	State    State
	DEK      []byte
}

var errLocalKeyNotFound = errors.New("named key not found")

var (
	localKeyNameFormat       = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	errLocalCiphertextFormat = errors.New("invalid local vault ciphertext")
)

func newFileStore(dataDir string, secretStore SecretStore) (*fileStore, error) {
	if strings.TrimSpace(dataDir) == "" {
		return nil, fmt.Errorf("data directory is required")
	}
	if !filepath.IsAbs(dataDir) {
		return nil, fmt.Errorf("data directory must be absolute: %q", dataDir)
	}
	if secretStore == nil {
		return nil, fmt.Errorf("vault KEK store is required")
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("failed to ensure data directory: %w", err)
	}

	// Fail fast if the local KEK is unreadable or malformed. Otherwise the
	// first envelope decrypt would fail later, far from the actual cause.
	localKey, err := secretStore.Load(localVaultKEKName)
	if err != nil {
		return nil, fmt.Errorf("failed to load local vault KEK: %w", err)
	}
	if len(localKey) != chacha20poly1305.KeySize {
		return nil, fmt.Errorf("invalid local vault KEK length: got %d bytes", len(localKey))
	}

	return &fileStore{
		dataDir:     dataDir,
		secretStore: secretStore,
	}, nil
}

func (s *fileStore) LoadEnvelope() (*Envelope, error) {
	return load(s.dataDir)
}

func (s *fileStore) SaveEnvelope(envelope *Envelope) error {
	return saveEnvelopeFile(s.dataDir, envelope)
}

func (s *fileStore) LoadSnapshot() (vaultSnapshot, error) {
	envelope, err := s.LoadEnvelope()
	if err != nil {
		return vaultSnapshot{}, err
	}
	if envelope == nil {
		return vaultSnapshot{State: newEmptyState()}, nil
	}

	dek, err := s.loadDataEncryptionKey(envelope)
	if err != nil {
		return vaultSnapshot{}, err
	}

	plaintext, err := s.decrypt(envelope.EncryptedData, dek)
	if err != nil {
		return vaultSnapshot{}, err
	}

	state, err := decodeState(plaintext)
	if err != nil {
		return vaultSnapshot{}, fmt.Errorf("failed to decode local vault state: %w", err)
	}

	return vaultSnapshot{
		Envelope: envelope,
		State:    state,
		DEK:      dek,
	}, nil
}

func (s *fileStore) SaveSnapshot(snapshot vaultSnapshot) error {
	plaintext, err := encodeState(snapshot.State)
	if err != nil {
		return fmt.Errorf("failed to encode local vault state: %w", err)
	}

	dek := snapshot.DEK
	if len(dek) == 0 {
		dek, err = newRandomSecret()
		if err != nil {
			return err
		}
	}

	ciphertext, err := s.encrypt(plaintext, dek)
	if err != nil {
		return err
	}

	envelope := snapshot.Envelope
	if envelope == nil {
		envelope = &Envelope{}
	}
	envelope.EncryptedData = ciphertext
	envelope.WrappedDEK, err = s.wrapDataEncryptionKey(envelope.Remote, dek)
	if err != nil {
		return err
	}

	return s.SaveEnvelope(envelope)
}

func (s *fileStore) loadDataEncryptionKey(envelope *Envelope) ([]byte, error) {
	if envelope == nil {
		return nil, fmt.Errorf("vault envelope is required")
	}
	if len(envelope.WrappedDEK) == 0 {
		return nil, fmt.Errorf("wrapped DEK is required")
	}

	wrappingKey, err := s.loadWrappingKey(envelope.Remote)
	if err != nil {
		return nil, err
	}

	return decryptXChaCha20Payload(envelope.WrappedDEK, wrappingKey, "wrapped DEK")
}

func (s *fileStore) wrapDataEncryptionKey(remote *RemoteState, dek []byte) ([]byte, error) {
	wrappingKey, err := s.loadWrappingKey(remote)
	if err != nil {
		return nil, err
	}

	return encryptXChaCha20Payload(dek, wrappingKey, "wrapped DEK")
}

func (s *fileStore) loadWrappingKey(remote *RemoteState) ([]byte, error) {
	if remote == nil {
		secret, err := s.secretStore.Load(localVaultKEKName)
		if err != nil {
			return nil, fmt.Errorf("failed to load local vault KEK: %w", err)
		}
		if len(secret) != chacha20poly1305.KeySize {
			return nil, fmt.Errorf("invalid local vault KEK length: got %d bytes", len(secret))
		}
		return secret, nil
	}

	remoteKEKName, err := remoteVaultKEKName(remote.RemoteURL, remote.UserID)
	if err != nil {
		return nil, err
	}

	secret, err := s.secretStore.Load(remoteKEKName)
	if err != nil {
		return nil, fmt.Errorf("failed to load remote vault KEK: %w", err)
	}
	if len(secret) != chacha20poly1305.KeySize {
		return nil, fmt.Errorf("invalid remote vault KEK length: got %d bytes", len(secret))
	}

	return secret, nil
}

func (s *fileStore) encrypt(plaintext []byte, dek []byte) ([]byte, error) {
	return encryptXChaCha20Payload(plaintext, dek, "local vault payload")
}

func (s *fileStore) decrypt(ciphertext []byte, dek []byte) ([]byte, error) {
	if len(ciphertext) < chacha20poly1305.NonceSizeX {
		return nil, fmt.Errorf("%w: expected at least %d bytes, got %d", errLocalCiphertextFormat, chacha20poly1305.NonceSizeX, len(ciphertext))
	}

	return decryptXChaCha20Payload(ciphertext, dek, "local vault payload")
}
