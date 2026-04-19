// Package vault implements the encrypted local vault file and optional remote sync state.
package vault

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"seed/backend/util/atomicfile"
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
	RemoteURL     string `json:"vaultUrl"`
	UserID        string `json:"userId"`
	CredentialID  string `json:"credentialId"`
	LocalVersion  int    `json:"localVersion,omitempty"`
	RemoteVersion int    `json:"remoteVersion,omitempty"`
	LastSyncTime  int64  `json:"lastSyncTime,omitempty"`
	LastSyncError string `json:"lastSyncError,omitempty"`
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
