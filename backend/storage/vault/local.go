package vault

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"seed/backend/core"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/chacha20poly1305"
)

type localStore struct {
	mu          sync.Mutex
	dataDir     string
	secretStore SecretStore
}

var errLocalKeyNotFound = errors.New("named key not found")

var (
	localKeyNameFormat       = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	errLocalCiphertextFormat = errors.New("invalid local vault ciphertext")
)

func newLocalStore(dataDir string, secretStore SecretStore) (*localStore, error) {
	if strings.TrimSpace(dataDir) == "" {
		return nil, fmt.Errorf("data directory is required")
	}
	if !filepath.IsAbs(dataDir) {
		return nil, fmt.Errorf("data directory must be absolute: %q", dataDir)
	}
	if _, err := ensureLocalKEK(secretStore); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to ensure data directory: %w", err)
	}

	return &localStore{
		dataDir:     dataDir,
		secretStore: secretStore,
	}, nil
}

func ensureLocalKEK(store SecretStore) ([]byte, error) {
	if store == nil {
		return nil, fmt.Errorf("vault KEK store is required")
	}

	localKey, err := store.Ensure(localVaultKEKName)
	if err != nil {
		return nil, fmt.Errorf("failed to load local vault KEK: %w", err)
	}
	if len(localKey) != chacha20poly1305.KeySize {
		return nil, fmt.Errorf("invalid local vault KEK length: got %d bytes", len(localKey))
	}

	return append([]byte(nil), localKey...), nil
}

func (ks *localStore) GetKey(_ context.Context, name string) (*core.KeyPair, error) {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	_, state, err := ks.loadState()
	if err != nil {
		return nil, err
	}

	account, ok := findAccountByName(state.Accounts, name)
	if !ok {
		return nil, fmt.Errorf("%s: %w", name, errLocalKeyNotFound)
	}

	return keyPairFromAccount(account)
}

func (ks *localStore) StoreKey(ctx context.Context, name string, kp *core.KeyPair) error {
	return ks.StoreKeyWithMetadata(ctx, name, kp, KeyMetadata{})
}

// StoreKeyWithMetadata stores a key together with vault-specific metadata.
func (ks *localStore) StoreKeyWithMetadata(_ context.Context, name string, kp *core.KeyPair, metadata KeyMetadata) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if !localKeyNameFormat.MatchString(name) {
		return fmt.Errorf("invalid name format")
	}
	if kp == nil {
		return fmt.Errorf("can't store empty key")
	}

	envelope, state, err := ks.loadState()
	if err != nil {
		return err
	}

	if _, ok := findAccountByName(state.Accounts, name); ok {
		return fmt.Errorf("name already exists, delete it first")
	}

	seed, err := exportedSeed(kp)
	if err != nil {
		return err
	}
	accountID, err := accountIDFromSeed(seed)
	if err != nil {
		return err
	}

	state.Accounts = append(state.Accounts, payloadAccountFromMetadata(name, seed, metadata))
	if state.Accounts[len(state.Accounts)-1].CreateTime == 0 {
		state.Accounts[len(state.Accounts)-1].CreateTime = time.Now().UTC().UnixMilli()
	}
	delete(state.DeletedAccounts, accountID)
	return ks.saveState(envelope, state)
}

func (ks *localStore) ListKeys(_ context.Context) ([]core.NamedKey, error) {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	_, state, err := ks.loadState()
	if err != nil {
		return nil, err
	}

	out := make([]core.NamedKey, 0, len(state.Accounts))
	for _, account := range state.Accounts {
		kp, err := keyPairFromAccount(account)
		if err != nil {
			return nil, err
		}

		out = append(out, core.NamedKey{
			Name:      account.Name,
			PublicKey: kp.PublicKey.Principal(),
		})
	}

	return out, nil
}

func (ks *localStore) DeleteKey(_ context.Context, name string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	envelope, state, err := ks.loadState()
	if err != nil {
		return err
	}

	accountIdx := findAccountIndexByName(state.Accounts, name)
	if accountIdx < 0 {
		return errLocalKeyNotFound
	}

	deleteKey, err := accountIDFromAccount(state.Accounts[accountIdx])
	if err != nil {
		return err
	}

	state.Accounts = append(state.Accounts[:accountIdx], state.Accounts[accountIdx+1:]...)
	recordAccountDeletion(&state, deleteKey, time.Now().UTC().UnixMilli())
	return ks.saveState(envelope, state)
}

func (ks *localStore) DeleteAllKeys(_ context.Context) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	envelope, state, err := ks.loadState()
	if err != nil {
		return err
	}

	deleteTime := time.Now().UTC().UnixMilli()
	for _, account := range state.Accounts {
		deleteKey, err := accountIDFromAccount(account)
		if err != nil {
			return err
		}
		recordAccountDeletion(&state, deleteKey, deleteTime)
	}
	state.Accounts = []AccountInfo{}
	return ks.saveState(envelope, state)
}

func (ks *localStore) ChangeKeyName(_ context.Context, currentName, newName string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if currentName == newName {
		return fmt.Errorf("new name equals current name")
	}
	if !localKeyNameFormat.MatchString(newName) {
		return fmt.Errorf("invalid new name format")
	}

	envelope, state, err := ks.loadState()
	if err != nil {
		return err
	}

	accountIdx := findAccountIndexByName(state.Accounts, currentName)
	if accountIdx < 0 {
		return errLocalKeyNotFound
	}
	if _, exists := findAccountByName(state.Accounts, newName); exists {
		return fmt.Errorf("name already exists, delete it first")
	}

	state.Accounts[accountIdx].Name = newName
	return ks.saveState(envelope, state)
}

func (ks *localStore) loadState() (*Envelope, State, error) {
	envelope, state, _, err := ks.loadStateWithDEK()
	return envelope, state, err
}

func (ks *localStore) loadStateWithDEK() (*Envelope, State, []byte, error) {
	envelope, err := load(ks.dataDir)
	if err != nil {
		return nil, State{}, nil, err
	}
	if envelope == nil {
		return nil, newEmptyState(), nil, nil
	}

	dek, err := ks.loadDataEncryptionKey(envelope)
	if err != nil {
		return nil, State{}, nil, err
	}

	plaintext, err := ks.decrypt(envelope.EncryptedData, dek)
	if err != nil {
		return nil, State{}, nil, err
	}

	state, err := decodeState(plaintext)
	if err != nil {
		return nil, State{}, nil, fmt.Errorf("failed to decode local vault state: %w", err)
	}

	return envelope, state, dek, nil
}

func (ks *localStore) saveState(existingEnvelope *Envelope, state State) error {
	plaintext, err := encodeState(state)
	if err != nil {
		return fmt.Errorf("failed to encode local vault state: %w", err)
	}

	dek := []byte(nil)
	if existingEnvelope != nil {
		dek, err = ks.loadDataEncryptionKey(existingEnvelope)
		if err != nil {
			return err
		}
	} else {
		dek, err = newRandomSecret()
		if err != nil {
			return err
		}
	}

	ciphertext, err := ks.encrypt(plaintext, dek)
	if err != nil {
		return err
	}

	next := &Envelope{EncryptedData: ciphertext}
	if existingEnvelope != nil {
		next.Credentials = append([]Credential(nil), existingEnvelope.Credentials...)
		next.Remote = cloneRemoteState(existingEnvelope.Remote)
		if next.Remote != nil {
			next.Remote.LocalVersion++
		}
	}
	next.WrappedDEK, err = ks.wrapDataEncryptionKey(next.Remote, dek)
	if err != nil {
		return err
	}

	return saveEnvelopeFile(ks.dataDir, next)
}

func (ks *localStore) loadDataEncryptionKey(envelope *Envelope) ([]byte, error) {
	if envelope == nil {
		return nil, fmt.Errorf("vault envelope is required")
	}
	if len(envelope.WrappedDEK) == 0 {
		return nil, fmt.Errorf("wrapped DEK is required")
	}

	wrappingKey, err := ks.loadWrappingKey(envelope.Remote)
	if err != nil {
		return nil, err
	}

	return decryptXChaCha20Payload(envelope.WrappedDEK, wrappingKey, "wrapped DEK")
}

func (ks *localStore) wrapDataEncryptionKey(remote *RemoteState, dek []byte) ([]byte, error) {
	wrappingKey, err := ks.loadWrappingKey(remote)
	if err != nil {
		return nil, err
	}

	return encryptXChaCha20Payload(dek, wrappingKey, "wrapped DEK")
}

func (ks *localStore) loadWrappingKey(remote *RemoteState) ([]byte, error) {
	if ks.secretStore == nil {
		return nil, fmt.Errorf("vault KEK store is required")
	}
	if remote == nil {
		return ensureLocalKEK(ks.secretStore)
	}

	remoteKEKName, err := remoteVaultKEKName(remote.RemoteURL, remote.UserID)
	if err != nil {
		return nil, err
	}

	secret, err := ks.secretStore.Load(remoteKEKName)
	if err != nil {
		return nil, fmt.Errorf("failed to load remote vault KEK: %w", err)
	}
	if len(secret) != chacha20poly1305.KeySize {
		return nil, fmt.Errorf("invalid remote vault KEK length: got %d bytes", len(secret))
	}

	return append([]byte(nil), secret...), nil
}

func (ks *localStore) encrypt(plaintext []byte, dek []byte) ([]byte, error) {
	return encryptXChaCha20Payload(plaintext, dek, "local vault payload")
}

func (ks *localStore) decrypt(ciphertext []byte, dek []byte) ([]byte, error) {
	if len(ciphertext) < chacha20poly1305.NonceSizeX {
		return nil, fmt.Errorf("%w: expected at least %d bytes, got %d", errLocalCiphertextFormat, chacha20poly1305.NonceSizeX, len(ciphertext))
	}

	return decryptXChaCha20Payload(ciphertext, dek, "local vault payload")
}
