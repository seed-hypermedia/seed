package vault

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/url"
	"seed/backend/core"
	"sort"
	"strings"
	"sync"
	"time"

	cid "github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"golang.org/x/crypto/chacha20poly1305"
)

// Vault is a the main vault implementation with local file and optional remote syncing.
type Vault struct {
	mu           sync.RWMutex
	remoteSyncMu sync.Mutex

	store *fileStore

	secretStore  SecretStore
	httpClient   *http.Client
	pollInterval time.Duration
	pollTimeout  time.Duration

	connection *connectionState
}

// New creates a vault-backed keystore with optional remote-sync support.
func New(dataDir string, secretStore SecretStore, opts ...RemoteOption) (*Vault, error) {
	ks := &Vault{
		secretStore:  secretStore,
		httpClient:   defaultRemoteHTTPClient(),
		pollInterval: defaultPollInterval,
		pollTimeout:  defaultPollTimeout,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(ks)
		}
	}
	if ks.httpClient == nil {
		ks.httpClient = defaultRemoteHTTPClient()
	}
	store, err := newFileStore(dataDir, ks.secretStore)
	if err != nil {
		return nil, err
	}
	ks.store = store

	return ks, nil
}

// KeyMetadata describes vault-specific metadata attached to a stored key.
type KeyMetadata struct {
	// CreateTime is the creation time of the key/account when known.
	CreateTime time.Time
	// Delegations lists delegations associated with the key.
	Delegations []Delegation
}

// Delegation describes a delegated session or linked device stored in the vault.
type Delegation struct {
	// ClientID identifies the delegated client when known.
	ClientID string
	// DeviceType identifies the delegated device type when known.
	DeviceType string
	// CapabilityCID is the CID of the underlying capability blob.
	CapabilityCID cid.Cid
	// Delegate is the delegated principal.
	Delegate core.Principal
	// CreateTime is the delegation creation time when known.
	CreateTime time.Time
}

func payloadAccountFromMetadata(name string, seed []byte, metadata KeyMetadata) AccountInfo {
	return AccountInfo{
		Name:        name,
		Seed:        seed,
		CreateTime:  payloadUnixMilli(metadata.CreateTime),
		Delegations: payloadDelegationsFromMetadata(metadata.Delegations),
	}
}

func payloadDelegationsFromMetadata(delegations []Delegation) []DelegationInfo {
	if len(delegations) == 0 {
		return []DelegationInfo{}
	}

	out := make([]DelegationInfo, 0, len(delegations))
	for _, delegation := range delegations {
		out = append(out, DelegationInfo{
			ClientID:   delegation.ClientID,
			DeviceType: delegation.DeviceType,
			Capability: CapabilityInfo{
				CID:      delegation.CapabilityCID,
				Delegate: delegation.Delegate,
			},
			CreateTime: payloadUnixMilli(delegation.CreateTime),
		})
	}

	return out
}

func payloadUnixMilli(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}

	return t.UTC().UnixMilli()
}

const (
	connectionTokenRawLength = 32
	connectionTokenTTL       = 2 * time.Minute
	controlMaxBody           = 4 << 10   // 4 KiB.
	fetchMaxBody             = 120 << 20 // 120 MiB.
	defaultPollInterval      = 2 * time.Second
	defaultPollTimeout       = 2 * time.Minute

	vaultPath = "api/vault"
)

var (
	errRemoteWriteConflict = errors.New("remote vault write conflict")
)

var (
	// ErrInvalidRemoteURL reports that the remote vault URL is invalid.
	ErrInvalidRemoteURL = errors.New("invalid vault URL")
	// ErrAlreadyConnected reports that the remote vault is already connected.
	ErrAlreadyConnected = errors.New("remote vault is already connected")
	// ErrConnectionInProgress reports that a vault connection handoff is already in progress.
	ErrConnectionInProgress = errors.New("vault connection is already in progress")
	// ErrConnectionTokenExpired reports that the browser handoff token expired.
	ErrConnectionTokenExpired = errors.New("vault handoff token expired")
	// ErrConnectionTokenInvalid reports that the browser handoff token is invalid.
	ErrConnectionTokenInvalid = errors.New("vault handoff token is invalid")
	// ErrConnectionRemoteURLMismatch reports that the browser handoff targeted a different remote vault URL.
	ErrConnectionRemoteURLMismatch = errors.New("vault URL mismatch")
)

// Status describes vault backend and sync state.
type Status struct {
	RemoteMode    bool
	RemoteURL     string
	LocalVersion  int
	RemoteVersion int
	LastSyncTime  time.Time
	LastSyncError string
}

// ConnectionStart is the result of starting a browser-mediated vault connection.
type ConnectionStart struct {
	RemoteURL    string
	HandoffToken string
	ExpireTime   time.Time
}

// ConnectionHandoff is the one-time browser handoff response.
type ConnectionHandoff struct {
	RemoteURL    string
	UserID       string
	CredentialID string
	Credential   string
}

type connectionState struct {
	remoteURL  string
	token      string
	expireTime time.Time
}

// GetVaultResponse is the remote vault payload returned by the HTTP API.
type GetVaultResponse struct {
	EncryptedData string       `json:"encryptedData"`
	RemoteVersion int          `json:"version"`
	Credentials   []Credential `json:"credentials"`
	Unchanged     bool         `json:"unchanged"`
}

// Credential describes one remote vault credential returned by the vault service.
type Credential struct {
	Kind         string `json:"kind"`
	CredentialID string `json:"credentialId"`
	WrappedDEK   string `json:"wrappedDEK"`
}

func cloneRemoteState(remote *RemoteState) *RemoteState {
	if remote == nil {
		return nil
	}

	clone := *remote
	return &clone
}

func mergeCredentialJSONs(existing []Credential, incoming []Credential) []Credential {
	if len(existing) == 0 && len(incoming) == 0 {
		return []Credential{}
	}

	seen := make(map[string]struct{}, len(existing)+len(incoming))
	merged := make([]Credential, 0, len(existing)+len(incoming))
	appendCredential := func(credential Credential) {
		key := credential.Kind + "\x00" + credential.CredentialID + "\x00" + credential.WrappedDEK
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		merged = append(merged, credential)
	}

	for _, credential := range existing {
		appendCredential(credential)
	}
	for _, credential := range incoming {
		appendCredential(credential)
	}

	return merged
}

type saveRequest struct {
	EncryptedData   string `json:"encryptedData"`
	ExpectedVersion int    `json:"version"`
}

type saveResponse struct {
	Success bool `json:"success"`
}

type mergeAccount struct {
	Principal string
	Account   AccountInfo
	KeyPair   *core.KeyPair
}

type normalizedState struct {
	NotificationServerURL string
	Accounts              map[string]mergeAccount
	DeletedAccounts       map[string]int64
	Extra                 map[string]any
}

// RemoteOption configures a Remote during construction.
type RemoteOption func(*Vault)

// WithHTTPClient overrides the HTTP client used for remote vault operations.
func WithHTTPClient(client *http.Client) RemoteOption {
	return func(ks *Vault) {
		ks.httpClient = client
	}
}

// WithPollingConfig overrides background polling timings.
func WithPollingConfig(interval, timeout time.Duration) RemoteOption {
	return func(ks *Vault) {
		if interval > 0 {
			ks.pollInterval = interval
		}
		if timeout > 0 {
			ks.pollTimeout = timeout
		}
	}
}

func defaultRemoteHTTPClient() *http.Client {
	return &http.Client{Timeout: 5 * time.Second}
}

// ResumeRemoteConnection refreshes remote sync state for an already-connected vault.
func (ks *Vault) ResumeRemoteConnection() {
	go ks.syncRemoteMaybe(context.Background())
}

// SetPendingConnectionExpiry rewrites the current pending handoff expiry.
func (ks *Vault) SetPendingConnectionExpiry(expireTime time.Time) {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if ks.connection == nil {
		return
	}

	ks.connection.expireTime = expireTime
}

// GetKey returns the named key from the local vault state.
func (ks *Vault) GetKey(_ context.Context, name string) (*core.KeyPair, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	_, state, err := ks.loadStateLocked()
	if err != nil {
		return nil, err
	}

	account, ok := findAccountByName(state.Accounts, name)
	if !ok {
		return nil, fmt.Errorf("%s: %w", name, errLocalKeyNotFound)
	}

	return keyPairFromAccount(account)
}

// StoreKey stores a new named key and schedules remote sync when remote mode is active.
func (ks *Vault) StoreKey(ctx context.Context, name string, kp *core.KeyPair) error {
	return ks.StoreKeyWithMetadata(ctx, name, kp, KeyMetadata{})
}

// StoreKeyWithMetadata stores a new named key with vault-specific metadata and schedules remote sync when remote mode is active.
func (ks *Vault) StoreKeyWithMetadata(ctx context.Context, name string, kp *core.KeyPair, metadata KeyMetadata) error {
	if !localKeyNameFormat.MatchString(name) {
		return fmt.Errorf("invalid name format")
	}
	if kp == nil {
		return fmt.Errorf("can't store empty key")
	}

	seed, err := exportedSeed(kp)
	if err != nil {
		return err
	}
	accountID, err := accountIDFromSeed(seed)
	if err != nil {
		return err
	}

	shouldSync, err := ks.applyMutation(func(state *State) (bool, error) {
		if _, ok := findAccountByName(state.Accounts, name); ok {
			return false, fmt.Errorf("name already exists, delete it first")
		}
		state.Accounts = append(state.Accounts, payloadAccountFromMetadata(name, seed, metadata))
		if state.Accounts[len(state.Accounts)-1].CreateTime == 0 {
			state.Accounts[len(state.Accounts)-1].CreateTime = time.Now().UTC().UnixMilli()
		}
		delete(state.DeletedAccounts, accountID)
		return true, nil
	})
	if err != nil {
		return err
	}
	if shouldSync {
		ks.scheduleRemoteSync()
	}

	return nil
}

// ListKeys lists all named keys from the local vault state.
func (ks *Vault) ListKeys(_ context.Context) ([]core.NamedKey, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	_, state, err := ks.loadStateLocked()
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

// ListKeyPairs lists all named keys together with their private key material.
func (ks *Vault) ListKeyPairs(_ context.Context) ([]core.NamedKeyPair, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	_, state, err := ks.loadStateLocked()
	if err != nil {
		return nil, err
	}

	out := make([]core.NamedKeyPair, 0, len(state.Accounts))
	for _, account := range state.Accounts {
		kp, err := keyPairFromAccount(account)
		if err != nil {
			return nil, err
		}

		out = append(out, core.NamedKeyPair{
			Name:    account.Name,
			KeyPair: kp,
		})
	}

	return out, nil
}

// DeleteKey removes a named key and schedules remote sync when remote mode is active.
func (ks *Vault) DeleteKey(ctx context.Context, name string) error {
	shouldSync, err := ks.applyMutation(func(state *State) (bool, error) {
		accountIdx := findAccountIndexByName(state.Accounts, name)
		if accountIdx < 0 {
			return false, errLocalKeyNotFound
		}

		deleteKey, err := accountIDFromAccount(state.Accounts[accountIdx])
		if err != nil {
			return false, err
		}

		state.Accounts = append(state.Accounts[:accountIdx], state.Accounts[accountIdx+1:]...)
		recordAccountDeletion(state, deleteKey, time.Now().UTC().UnixMilli())
		return true, nil
	})
	if err != nil {
		return err
	}
	if shouldSync {
		ks.scheduleRemoteSync()
	}

	return nil
}

// DeleteAllKeys removes all named keys and schedules remote sync when remote mode is active.
func (ks *Vault) DeleteAllKeys(ctx context.Context) error {
	shouldSync, err := ks.applyMutation(func(state *State) (bool, error) {
		if len(state.Accounts) == 0 {
			return false, nil
		}

		deleteTime := time.Now().UTC().UnixMilli()
		for _, account := range state.Accounts {
			deleteKey, err := accountIDFromAccount(account)
			if err != nil {
				return false, err
			}
			recordAccountDeletion(state, deleteKey, deleteTime)
		}
		state.Accounts = []AccountInfo{}
		return true, nil
	})
	if err != nil {
		return err
	}
	if shouldSync {
		ks.scheduleRemoteSync()
	}

	return nil
}

// ChangeKeyName renames a stored key and schedules remote sync when remote mode is active.
func (ks *Vault) ChangeKeyName(ctx context.Context, currentName, newName string) error {
	if currentName == newName {
		return fmt.Errorf("new name equals current name")
	}
	if !localKeyNameFormat.MatchString(newName) {
		return fmt.Errorf("invalid new name format")
	}

	shouldSync, err := ks.applyMutation(func(state *State) (bool, error) {
		accountIdx := findAccountIndexByName(state.Accounts, currentName)
		if accountIdx < 0 {
			return false, errLocalKeyNotFound
		}
		if _, exists := findAccountByName(state.Accounts, newName); exists {
			return false, fmt.Errorf("name already exists, delete it first")
		}

		state.Accounts[accountIdx].Name = newName
		return true, nil
	})
	if err != nil {
		return err
	}
	if shouldSync {
		ks.scheduleRemoteSync()
	}

	return nil
}

// Status returns backend mode and sync metadata from the local vault file.
func (ks *Vault) Status() (Status, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	envelope, err := ks.store.LoadEnvelope()
	if err != nil {
		return Status{}, fmt.Errorf("failed to load vault envelope: %w", err)
	}
	if envelope == nil {
		return Status{}, nil
	}

	status := Status{}
	if envelope.Remote != nil {
		status.RemoteMode = true
		status.RemoteURL = envelope.Remote.RemoteURL
		status.LocalVersion = envelope.Remote.LocalVersion
		status.RemoteVersion = envelope.Remote.RemoteVersion
		status.LastSyncError = envelope.Remote.LastSyncError
		if envelope.Remote.LastSyncTime > 0 {
			status.LastSyncTime = time.Unix(envelope.Remote.LastSyncTime, 0).UTC()
		}
	}

	return status, nil
}

// StartConnection prepares a browser-mediated remote vault connection handoff.
func (ks *Vault) StartConnection(remoteURL string, force bool) (ConnectionStart, error) {
	normalizedRemoteURL, err := normalizeOriginURL(strings.TrimSpace(remoteURL))
	if err != nil {
		return ConnectionStart{}, err
	}

	status, err := ks.Status()
	if err != nil {
		return ConnectionStart{}, err
	}
	if status.RemoteMode && !force {
		return ConnectionStart{}, fmt.Errorf("%w; retry with force=true", ErrAlreadyConnected)
	}

	now := time.Now().UTC()

	ks.mu.Lock()
	defer ks.mu.Unlock()

	if ks.connection != nil && now.Before(ks.connection.expireTime) && !force {
		return ConnectionStart{}, fmt.Errorf("%w; retry with force=true", ErrConnectionInProgress)
	}

	token, err := newConnectionToken()
	if err != nil {
		return ConnectionStart{}, fmt.Errorf("failed to create vault connection token: %w", err)
	}

	state := &connectionState{
		remoteURL:  normalizedRemoteURL,
		token:      token,
		expireTime: now.Add(connectionTokenTTL),
	}
	ks.connection = state

	return ConnectionStart{
		RemoteURL:    state.remoteURL,
		HandoffToken: state.token,
		ExpireTime:   state.expireTime,
	}, nil
}

// HandleConnection finalizes a browser-mediated remote vault connection.
func (ks *Vault) HandleConnection(handoffToken string, handoff ConnectionHandoff) error {
	normalizedURL, err := normalizeOriginURL(strings.TrimSpace(handoff.RemoteURL))
	if err != nil {
		return err
	}

	userID := strings.TrimSpace(handoff.UserID)
	if userID == "" {
		return fmt.Errorf("remote vault user ID is required")
	}

	credentialID := strings.TrimSpace(handoff.CredentialID)
	if credentialID == "" {
		return fmt.Errorf("remote credential ID is required")
	}

	encodedSecret := strings.TrimSpace(handoff.Credential)
	if encodedSecret == "" {
		return fmt.Errorf("remote secret is required")
	}

	decodedSecret, err := decodeBase64URLField(encodedSecret, "remote secret")
	if err != nil {
		return err
	}
	if len(decodedSecret) != vaultSecretSize {
		return fmt.Errorf("invalid remote secret length: got %d bytes", len(decodedSecret))
	}

	if err := ks.consumeConnectionHandoff(strings.TrimSpace(handoffToken), normalizedURL, time.Now().UTC()); err != nil {
		return err
	}
	remoteKEKName, err := remoteVaultKEKName(normalizedURL, userID)
	if err != nil {
		return err
	}
	if err := ks.secretStore.Store(remoteKEKName, decodedSecret); err != nil {
		return err
	}

	return ks.finishConnection(context.Background(), normalizedURL, userID, credentialID, encodedSecret)
}

// Disconnect clears remote vault metadata/state and switches back to local mode.
func (ks *Vault) Disconnect() error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	snapshot, err := ks.loadSnapshotLocked()
	if err != nil {
		return err
	}
	if snapshot.Envelope == nil {
		ks.connection = nil
		return nil
	}

	previousRemote := cloneRemoteState(snapshot.Envelope.Remote)
	snapshot.Envelope.Remote = nil
	snapshot.Envelope.Credentials = nil
	if err := ks.saveSnapshotLocked(snapshot); err != nil {
		return fmt.Errorf("failed to save disconnected vault envelope: %w", err)
	}
	if previousRemote != nil {
		remoteKEKName, err := remoteVaultKEKName(previousRemote.RemoteURL, previousRemote.UserID)
		if err == nil {
			_ = ks.secretStore.Delete(remoteKEKName)
		}
	}

	ks.connection = nil
	return nil
}

func (ks *Vault) applyMutation(fn func(state *State) (bool, error)) (shouldSync bool, err error) {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	snapshot, err := ks.loadSnapshotLocked()
	if err != nil {
		return false, err
	}

	changed, err := fn(&snapshot.State)
	if err != nil || !changed {
		return false, err
	}

	if snapshot.Envelope == nil {
		snapshot.Envelope = &Envelope{}
	}
	if snapshot.Envelope.Remote != nil {
		snapshot.Envelope.Remote.LocalVersion++
	}
	if err := ks.saveSnapshotLocked(snapshot); err != nil {
		return false, err
	}

	return ks.shouldSyncRemote(snapshot.Envelope), nil
}

func (ks *Vault) loadSnapshotLocked() (vaultSnapshot, error) {
	snapshot, err := ks.store.LoadSnapshot()
	if err != nil {
		return vaultSnapshot{}, fmt.Errorf("failed to load vault state: %w", err)
	}

	return snapshot, nil
}

func (ks *Vault) loadStateLocked() (*Envelope, State, error) {
	snapshot, err := ks.loadSnapshotLocked()
	if err != nil {
		return nil, State{}, err
	}

	return snapshot.Envelope, snapshot.State, nil
}

func (ks *Vault) saveSnapshotLocked(snapshot vaultSnapshot) error {
	if err := ks.store.SaveSnapshot(snapshot); err != nil {
		return fmt.Errorf("failed to save vault state: %w", err)
	}

	return nil
}

func (ks *Vault) consumeConnectionHandoff(handoffToken string, remoteURL string, now time.Time) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if ks.connection == nil {
		return ErrConnectionTokenInvalid
	}
	if now.After(ks.connection.expireTime) {
		ks.connection = nil
		return ErrConnectionTokenExpired
	}
	if subtle.ConstantTimeCompare([]byte(handoffToken), []byte(ks.connection.token)) != 1 {
		return ErrConnectionTokenInvalid
	}
	if strings.TrimSpace(ks.connection.remoteURL) != strings.TrimSpace(remoteURL) {
		return fmt.Errorf("%w: expected %s, got %s", ErrConnectionRemoteURLMismatch, ks.connection.remoteURL, remoteURL)
	}

	ks.connection = nil
	return nil
}

func (ks *Vault) finishConnection(ctx context.Context, remoteURL string, userID string, credentialID string, secret string) error {
	bearerAuth, err := buildRemoteBearerAuth(credentialID, secret)
	if err != nil {
		return fmt.Errorf("failed to derive remote vault bearer auth: %w", err)
	}

	remoteSnapshot, err := ks.getRemote(ctx, remoteURL, bearerAuth, 0)
	if err != nil {
		return fmt.Errorf("failed to fetch remote snapshot: %w", err)
	}
	credential, err := remoteSnapshot.findCredential(credentialID)
	if err != nil {
		return err
	}
	if err := ks.mergeRemoteSnapshot(credentialID, secret, credential.WrappedDEK, remoteSnapshot); err != nil {
		return fmt.Errorf("failed to merge remote snapshot: %w", err)
	}

	remoteState := newEmptyState()
	if !remoteSnapshot.Unchanged && strings.TrimSpace(remoteSnapshot.EncryptedData) != "" {
		decodedRemoteState, err := decodeRemoteState(secret, credential.WrappedDEK, remoteSnapshot)
		if err != nil {
			return fmt.Errorf("failed to decode remote vault snapshot for credential %q: %w", credentialID, err)
		}
		remoteState = State(decodedRemoteState)
	}

	localState, syncedLocalVersion, err := ks.buildRemoteStateSnapshotFromLocal()
	if err != nil {
		return fmt.Errorf("failed to build local vault state: %w", err)
	}

	equal, err := statesEqual(remoteState, localState)
	if err != nil {
		return fmt.Errorf("failed to compare vault states: %w", err)
	}
	needsUpload := !equal

	remoteVersion := remoteSnapshot.RemoteVersion
	if needsUpload {
		saveReq, uploadedLocalVersion, err := ks.buildRemoteSaveRequest(ctx, secret, credentialID, credential.WrappedDEK, remoteSnapshot)
		if err != nil {
			return fmt.Errorf("failed to build remote vault save request: %w", err)
		}
		if err := ks.saveRemoteSnapshot(ctx, remoteURL, bearerAuth, saveReq); err != nil {
			return fmt.Errorf("remote vault upload failed: %w", err)
		}
		remoteVersion = saveReq.ExpectedVersion + 1
		syncedLocalVersion = uploadedLocalVersion
	}

	credentials := mergeCredentialJSONs(remoteSnapshot.Credentials, []Credential{credential})
	if err := ks.connect(remoteURL, userID, credentialID, secret, credential.WrappedDEK, credentials, remoteVersion, syncedLocalVersion, time.Now().UTC()); err != nil {
		return fmt.Errorf("failed to persist remote vault connection: %w", err)
	}

	return nil
}

func (ks *Vault) recordSyncFailure(message string) {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	envelope, err := ks.store.LoadEnvelope()
	if err != nil || envelope == nil || envelope.Remote == nil {
		return
	}

	envelope.Remote.LastSyncTime = time.Now().UTC().Unix()
	envelope.Remote.LastSyncError = strings.TrimSpace(message)
	_ = ks.store.SaveEnvelope(envelope)
}

func (ks *Vault) syncRemoteMaybe(ctx context.Context) {
	if err := ks.syncRemote(ctx); err != nil {
		ks.recordSyncFailure(fmt.Sprintf("remote sync failed after local mutation: %v", err))
	}
}

func (ks *Vault) scheduleRemoteSync() {
	go ks.syncRemoteMaybe(context.Background())
}

func (ks *Vault) syncRemote(ctx context.Context) error {
	ks.remoteSyncMu.Lock()
	defer ks.remoteSyncMu.Unlock()

	localRemote, localCredential, remoteSecret, enabled, err := ks.loadRemoteSyncState()
	if err != nil {
		return err
	}
	if !enabled {
		return nil
	}

	const maxAttempts = 3
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		bearerAuth, err := buildRemoteBearerAuth(localRemote.CredentialID, remoteSecret)
		if err != nil {
			return fmt.Errorf("failed to derive remote vault bearer auth: %w", err)
		}

		remoteSnapshot, err := ks.getRemote(ctx, localRemote.RemoteURL, bearerAuth, localRemote.RemoteVersion)
		if err != nil {
			return fmt.Errorf("failed to fetch remote snapshot: %w", err)
		}
		credential := Credential{
			Kind:         "secret",
			CredentialID: localRemote.CredentialID,
			WrappedDEK:   localCredential.WrappedDEK,
		}
		if !remoteSnapshot.Unchanged {
			credential, err = remoteSnapshot.findCredential(localRemote.CredentialID)
			if err != nil {
				return err
			}
		}
		if err := ks.mergeRemoteSnapshot(localRemote.CredentialID, remoteSecret, credential.WrappedDEK, remoteSnapshot); err != nil {
			return fmt.Errorf("failed to merge remote snapshot: %w", err)
		}

		needsUpload, syncedLocalVersion, err := ks.remoteNeedsUpload(localRemote, remoteSecret, credential.WrappedDEK, remoteSnapshot)
		if err != nil {
			return err
		}

		remoteVersion := remoteSnapshot.RemoteVersion
		if needsUpload {
			saveReq, uploadedLocalVersion, err := ks.buildRemoteSaveRequest(ctx, remoteSecret, localRemote.CredentialID, credential.WrappedDEK, remoteSnapshot)
			if err != nil {
				return err
			}
			if err := ks.saveRemoteSnapshot(ctx, localRemote.RemoteURL, bearerAuth, saveReq); err != nil {
				if errors.Is(err, errRemoteWriteConflict) && attempt < maxAttempts {
					continue
				}
				return err
			}
			remoteVersion = saveReq.ExpectedVersion + 1
			syncedLocalVersion = uploadedLocalVersion
		}

		credentials := mergeCredentialJSONs(remoteSnapshot.Credentials, []Credential{credential})
		if err := ks.recordRemoteSyncSuccess(localRemote, remoteSecret, credential.WrappedDEK, credentials, remoteVersion, syncedLocalVersion, time.Now().UTC()); err != nil {
			return fmt.Errorf("failed to persist remote sync success metadata: %w", err)
		}

		return nil
	}

	return fmt.Errorf("remote sync failed after conflict retries")
}

func (ks *Vault) recordRemoteSyncSuccess(
	expectedRemote RemoteState,
	remoteSecret string,
	wrappedDEK string,
	credentials []Credential,
	remoteVersion int,
	syncedLocalVersion int,
	syncTime time.Time,
) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	snapshot, err := ks.loadSnapshotLocked()
	if err != nil {
		return fmt.Errorf("failed to load vault state: %w", err)
	}
	if snapshot.Envelope == nil || snapshot.Envelope.Remote == nil {
		return nil
	}
	remote := snapshot.Envelope.Remote
	if remote.RemoteURL != expectedRemote.RemoteURL ||
		remote.UserID != expectedRemote.UserID ||
		remote.CredentialID != expectedRemote.CredentialID {
		return nil
	}

	dek, err := decodeRemoteDataEncryptionKey(remoteSecret, wrappedDEK)
	if err != nil {
		return fmt.Errorf("failed to decode remote vault DEK: %w", err)
	}

	remote.RemoteVersion = remoteVersion
	remote.SyncedLocalVersion = syncedLocalVersion
	remote.LastSyncTime = syncTime.UTC().Unix()
	remote.LastSyncError = ""
	snapshot.Envelope.Credentials = mergeCredentialJSONs(snapshot.Envelope.Credentials, credentials)
	snapshot.DEK = dek

	if err := ks.saveSnapshotLocked(snapshot); err != nil {
		return fmt.Errorf("failed to save remote vault sync metadata: %w", err)
	}

	return nil
}

func (ks *Vault) remoteNeedsUpload(
	localRemote RemoteState,
	remoteSecret string,
	wrappedDEK string,
	remoteSnapshot GetVaultResponse,
) (needsUpload bool, syncedLocalVersion int, err error) {
	if remoteSnapshot.Unchanged {
		return localRemote.LocalVersion != localRemote.SyncedLocalVersion, localRemote.SyncedLocalVersion, nil
	}

	remoteState := newEmptyState()
	if !remoteSnapshot.Unchanged && strings.TrimSpace(remoteSnapshot.EncryptedData) != "" {
		decodedRemoteState, err := decodeRemoteState(remoteSecret, wrappedDEK, remoteSnapshot)
		if err != nil {
			return false, 0, fmt.Errorf("failed to decode remote vault snapshot for credential %q: %w", localRemote.CredentialID, err)
		}
		remoteState = State(decodedRemoteState)
	}

	localState, localVersion, err := ks.buildRemoteStateSnapshotFromLocal()
	if err != nil {
		return false, 0, fmt.Errorf("failed to build local vault state: %w", err)
	}

	equal, err := statesEqual(remoteState, localState)
	if err != nil {
		return false, 0, fmt.Errorf("failed to compare vault states: %w", err)
	}

	return !equal, localVersion, nil
}

func (ks *Vault) loadRemoteSyncState() (remote RemoteState, credential Credential, remoteSecret string, syncEnabled bool, err error) {
	ks.mu.RLock()
	envelope, err := ks.store.LoadEnvelope()
	ks.mu.RUnlock()
	if err != nil {
		return RemoteState{}, Credential{}, "", false, fmt.Errorf("failed to read local vault status: %w", err)
	}
	if envelope == nil || envelope.Remote == nil || strings.TrimSpace(envelope.Remote.RemoteURL) == "" {
		return RemoteState{}, Credential{}, "", false, nil
	}
	remote = *envelope.Remote
	credential, err = GetVaultResponse{Credentials: envelope.Credentials}.findCredential(remote.CredentialID)
	if err != nil {
		return RemoteState{}, Credential{}, "", false, err
	}

	if ks.secretStore == nil {
		return RemoteState{}, Credential{}, "", false, fmt.Errorf("vault KEK store is required")
	}
	remoteKEKName, err := remoteVaultKEKName(remote.RemoteURL, remote.UserID)
	if err != nil {
		return RemoteState{}, Credential{}, "", false, err
	}
	remoteSecretBytes, err := ks.secretStore.Load(remoteKEKName)
	if err != nil {
		return RemoteState{}, Credential{}, "", false, fmt.Errorf("failed to load remote auth secret: %w", err)
	}

	return remote, credential, base64.RawURLEncoding.EncodeToString(remoteSecretBytes), true, nil
}

func (ks *Vault) shouldSyncRemote(envelope *Envelope) bool {
	if envelope == nil || envelope.Remote == nil {
		return false
	}

	return true
}

func buildRemoteBearerAuth(credentialID string, remoteSecret string) (string, error) {
	normalizedCredentialID := strings.TrimSpace(credentialID)
	if normalizedCredentialID == "" {
		return "", fmt.Errorf("remote vault credential ID is required")
	}

	decodedSecret, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(remoteSecret))
	if err != nil {
		return "", fmt.Errorf("invalid remote secret encoding: %w", err)
	}
	authKey, err := deriveRemoteAuthKey(decodedSecret)
	if err != nil {
		return "", err
	}

	return normalizedCredentialID + ":" + base64.RawURLEncoding.EncodeToString(authKey), nil
}

func (remote GetVaultResponse) findCredential(credentialID string) (Credential, error) {
	if credentialID == "" {
		return Credential{}, fmt.Errorf("remote vault credential ID is required")
	}

	for _, credential := range remote.Credentials {
		if credential.Kind != "secret" {
			continue
		}
		if credential.CredentialID != credentialID {
			continue
		}
		if strings.TrimSpace(credential.WrappedDEK) == "" {
			return Credential{}, fmt.Errorf("remote vault credential %q is missing wrapped DEK", credentialID)
		}
		return credential, nil
	}

	return Credential{}, fmt.Errorf("remote vault response is missing secret credential %q", credentialID)
}

func (ks *Vault) getRemote(
	ctx context.Context,
	remoteURL string,
	bearerAuth string,
	knownVersion int,
) (GetVaultResponse, error) {
	endpoint, err := resolveDaemonEndpointURL(remoteURL, vaultPath)
	if err != nil {
		return GetVaultResponse{}, err
	}
	if knownVersion > 0 {
		endpoint = fmt.Sprintf("%s?knownVersion=%d", endpoint, knownVersion)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return GetVaultResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+bearerAuth)

	resp, err := ks.httpClientDo(req)
	if err != nil {
		return GetVaultResponse{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := readRemoteBody(resp.Body, controlMaxBody, "remote vault error response")
		return GetVaultResponse{}, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var remoteResp GetVaultResponse
	if err := decodeRemoteJSON(resp.Body, fetchMaxBody, "remote vault response", &remoteResp); err != nil {
		return GetVaultResponse{}, err
	}
	if remoteResp.Unchanged {
		if knownVersion > 0 {
			remoteResp.RemoteVersion = knownVersion
		}
		if remoteResp.Credentials == nil {
			remoteResp.Credentials = []Credential{}
		}
		return remoteResp, nil
	}
	if remoteResp.Credentials == nil {
		remoteResp.Credentials = []Credential{}
	}

	return remoteResp, nil
}

func (ks *Vault) buildRemoteSaveRequest(
	_ context.Context,
	remoteSecret string,
	credentialID string,
	wrappedDEK string,
	remoteSnapshot GetVaultResponse,
) (saveRequest, int, error) {
	dek, err := decodeRemoteDataEncryptionKey(remoteSecret, wrappedDEK)
	if err != nil {
		return saveRequest{}, 0, fmt.Errorf("failed to decrypt wrapped DEK for remote credential %q: %w", credentialID, err)
	}

	localState, localVersion, err := ks.buildRemoteStateSnapshotFromLocal()
	if err != nil {
		return saveRequest{}, 0, err
	}

	encryptedData, err := encodeRemoteState(localState, dek)
	if err != nil {
		return saveRequest{}, 0, err
	}

	return saveRequest{EncryptedData: encryptedData, ExpectedVersion: remoteSnapshot.RemoteVersion}, localVersion, nil
}

func (ks *Vault) buildRemoteStateFromLocal() (State, error) {
	state, _, err := ks.buildRemoteStateSnapshotFromLocal()
	return state, err
}

func (ks *Vault) buildRemoteStateSnapshotFromLocal() (State, int, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	snapshot, err := ks.loadSnapshotLocked()
	if err != nil {
		return State{}, 0, fmt.Errorf("failed to load local vault state: %w", err)
	}

	state := snapshot.State
	state.SchemaVersion = stateSchemaVersion
	if state.Accounts == nil {
		state.Accounts = []AccountInfo{}
	}
	localVersion := 0
	if snapshot.Envelope != nil && snapshot.Envelope.Remote != nil {
		localVersion = snapshot.Envelope.Remote.LocalVersion
	}
	return state, localVersion, nil
}

func (ks *Vault) saveRemoteSnapshot(
	ctx context.Context,
	remoteURL string,
	bearerAuth string,
	saveReq saveRequest,
) error {
	reqBody, err := json.Marshal(saveReq)
	if err != nil {
		return fmt.Errorf("failed to encode remote vault save request: %w", err)
	}

	endpoint, err := resolveDaemonEndpointURL(remoteURL, vaultPath)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+bearerAuth)

	resp, err := ks.httpClientDo(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusConflict {
		return errRemoteWriteConflict
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := readRemoteBody(resp.Body, controlMaxBody, "remote vault save error response")
		return fmt.Errorf("unexpected save status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var saveResp saveResponse
	if err := decodeRemoteJSON(resp.Body, controlMaxBody, "remote vault save response", &saveResp); err != nil {
		return err
	}
	if !saveResp.Success {
		return fmt.Errorf("remote vault save response did not report success")
	}

	return nil
}

func (ks *Vault) mergeRemoteSnapshot(credentialID string, remoteSecret string, wrappedDEK string, remote GetVaultResponse) error {
	if remote.Unchanged || strings.TrimSpace(remote.EncryptedData) == "" {
		return nil
	}

	state, err := decodeRemoteState(remoteSecret, wrappedDEK, remote)
	if err != nil {
		return fmt.Errorf("failed to decode remote vault snapshot for credential %q: %w", credentialID, err)
	}

	status, err := ks.Status()
	if err != nil {
		return fmt.Errorf("failed to read local vault status for merge: %w", err)
	}

	return ks.mergeRemoteAccounts(status.LocalVersion, remote.RemoteVersion, state)
}

func (ks *Vault) mergeRemoteAccounts(
	localVersion int,
	remoteVersion int,
	remoteState State) error {
	remoteNormalized, err := normalizeRemoteState(remoteState)
	if err != nil {
		return err
	}

	ks.mu.Lock()
	defer ks.mu.Unlock()

	snapshot, err := ks.loadSnapshotLocked()
	if err != nil {
		return err
	}

	localNormalized, err := normalizeLocalState(snapshot.State)
	if err != nil {
		return err
	}

	mergedState, changed, err := mergeNormalizedStates(localNormalized, remoteNormalized, localVersion, remoteVersion)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}

	snapshot.State = mergedState
	return ks.saveSnapshotLocked(snapshot)
}

func (ks *Vault) connect(
	remoteURL string,
	userID string,
	credentialID string,
	remoteSecret string,
	wrappedDEK string,
	credentials []Credential,
	remoteVersion int,
	syncedLocalVersion int,
	syncTime time.Time,
) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	normalizedURL := strings.TrimSpace(remoteURL)
	if normalizedURL == "" {
		return fmt.Errorf("remote vault URL is required")
	}
	normalizedUserID := strings.TrimSpace(userID)
	if normalizedUserID == "" {
		return fmt.Errorf("remote vault user ID is required")
	}
	normalizedCredentialID := strings.TrimSpace(credentialID)
	if normalizedCredentialID == "" {
		return fmt.Errorf("remote vault credential ID is required")
	}

	snapshot, err := ks.loadSnapshotLocked()
	if err != nil {
		return fmt.Errorf("failed to load vault state: %w", err)
	}

	dek, err := decodeRemoteDataEncryptionKey(remoteSecret, wrappedDEK)
	if err != nil {
		return fmt.Errorf("failed to decode remote vault DEK: %w", err)
	}

	remote := &RemoteState{
		RemoteURL:          normalizedURL,
		UserID:             normalizedUserID,
		CredentialID:       normalizedCredentialID,
		RemoteVersion:      remoteVersion,
		SyncedLocalVersion: 0,
	}
	if snapshot.Envelope != nil && snapshot.Envelope.Remote != nil {
		remote.LocalVersion = snapshot.Envelope.Remote.LocalVersion
	}
	if !syncTime.IsZero() {
		remote.LastSyncTime = syncTime.UTC().Unix()
		remote.SyncedLocalVersion = syncedLocalVersion
	}
	if snapshot.Envelope == nil {
		snapshot.Envelope = &Envelope{}
	}
	snapshot.Envelope.Remote = remote
	snapshot.Envelope.Credentials = mergeCredentialJSONs(snapshot.Envelope.Credentials, credentials)
	snapshot.DEK = dek

	if err := ks.saveSnapshotLocked(snapshot); err != nil {
		return fmt.Errorf("failed to save connected vault envelope: %w", err)
	}

	return nil
}

func (ks *Vault) httpClientDo(req *http.Request) (*http.Response, error) {
	ks.mu.RLock()
	client := ks.httpClient
	ks.mu.RUnlock()
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}

	//nolint:gosec // Request URLs are derived from normalizeOriginURL + resolveDaemonEndpointURL before reaching this helper.
	return client.Do(req)
}

func readRemoteBody(body io.Reader, maxBytes int64, bodyName string) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read %s: %w", bodyName, err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("%s exceeds %d bytes", bodyName, maxBytes)
	}

	return data, nil
}

func decodeRemoteJSON(body io.Reader, maxBytes int64, bodyName string, dest any) error {
	data, err := readRemoteBody(body, maxBytes, bodyName)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, dest); err != nil {
		return fmt.Errorf("failed to decode %s: %w", bodyName, err)
	}

	return nil
}

func normalizeOriginURL(rawURL string) (string, error) {
	if rawURL == "" {
		return "", fmt.Errorf("%w: required", ErrInvalidRemoteURL)
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrInvalidRemoteURL, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("%w: must use http or https scheme", ErrInvalidRemoteURL)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("%w: host is required", ErrInvalidRemoteURL)
	}
	if parsed.User != nil {
		return "", fmt.Errorf("%w: must not include userinfo", ErrInvalidRemoteURL)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%w: must not include query or fragment", ErrInvalidRemoteURL)
	}

	normalizedPath := strings.TrimRight(parsed.EscapedPath(), "/")
	if normalizedPath == "" || normalizedPath == "/" {
		return (&url.URL{Scheme: parsed.Scheme, Host: parsed.Host}).String(), nil
	}

	return (&url.URL{Scheme: parsed.Scheme, Host: parsed.Host, Path: normalizedPath}).String(), nil
}

func resolveDaemonEndpointURL(remoteURL string, endpointPath string) (string, error) {
	parsed, err := url.Parse(remoteURL)
	if err != nil {
		return "", err
	}

	basePath := strings.TrimRight(parsed.EscapedPath(), "/")
	parsed.Path = basePath + "/" + strings.TrimLeft(endpointPath, "/")
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func newConnectionToken() (string, error) {
	rawToken := make([]byte, connectionTokenRawLength)
	n, err := rand.Read(rawToken)
	if err != nil {
		return "", err
	}
	if n != len(rawToken) {
		return "", fmt.Errorf("failed to generate random token")
	}

	return base64.RawURLEncoding.EncodeToString(rawToken), nil
}

func decodeRemoteState(remoteSecret string, wrappedDEK string, remote GetVaultResponse) (State, error) {
	dek, err := decodeRemoteDataEncryptionKey(remoteSecret, wrappedDEK)
	if err != nil {
		return State{}, err
	}

	encryptedPayload, err := decodeBase64URLField(remote.EncryptedData, "encrypted vault payload")
	if err != nil {
		return State{}, err
	}
	compressedPayload, err := decryptXChaCha20Payload(encryptedPayload, dek, "encrypted vault payload")
	if err != nil {
		return State{}, err
	}

	state, err := decodeState(compressedPayload)
	if err != nil {
		return State{}, err
	}

	return state, nil
}

func decodeRemoteDataEncryptionKey(remoteSecret string, wrappedDEK string) ([]byte, error) {
	decodedRemoteSecret, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(remoteSecret))
	if err != nil {
		return nil, fmt.Errorf("invalid remote secret encoding: %w", err)
	}

	encodedWrappedDEK := strings.TrimSpace(wrappedDEK)
	if encodedWrappedDEK == "" {
		return nil, fmt.Errorf("wrapped DEK is required")
	}

	decodedWrappedDEK, err := decodeBase64URLField(encodedWrappedDEK, "wrapped DEK")
	if err != nil {
		return nil, err
	}
	dek, err := decryptXChaCha20Payload(decodedWrappedDEK, decodedRemoteSecret, "wrapped DEK")
	if err != nil {
		return nil, err
	}

	return dek, nil
}

func encodeRemoteState(state State, dek []byte) (string, error) {
	encodedState, err := encodeState(state)
	if err != nil {
		return "", fmt.Errorf("failed to encode remote vault state: %w", err)
	}

	encryptedPayload, err := encryptXChaCha20Payload(encodedState, dek, "remote vault payload")
	if err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(encryptedPayload), nil
}

func encryptXChaCha20Payload(plaintext []byte, key []byte, fieldName string) ([]byte, error) {
	if len(key) < chacha20poly1305.KeySize {
		return nil, fmt.Errorf("%s encryption key is too short: got %d bytes", fieldName, len(key))
	}

	aead, err := chacha20poly1305.NewX(key[:chacha20poly1305.KeySize])
	if err != nil {
		return nil, fmt.Errorf("failed to initialize %s cipher: %w", fieldName, err)
	}

	nonce := make([]byte, chacha20poly1305.NonceSizeX)
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("failed to generate %s nonce: %w", fieldName, err)
	}

	ciphertext := aead.Seal(nil, nonce, plaintext, nil)
	output := make([]byte, 0, len(nonce)+len(ciphertext))
	output = append(output, nonce...)
	output = append(output, ciphertext...)
	return output, nil
}

func decodeBase64URLField(encoded string, fieldName string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, fmt.Errorf("invalid %s encoding: %w", fieldName, err)
	}

	return decoded, nil
}

func decryptXChaCha20Payload(ciphertext []byte, key []byte, fieldName string) ([]byte, error) {
	if len(key) < chacha20poly1305.KeySize {
		return nil, fmt.Errorf("%s decryption key is too short: got %d bytes", fieldName, len(key))
	}
	if len(ciphertext) < chacha20poly1305.NonceSizeX {
		return nil, fmt.Errorf("invalid %s ciphertext: expected at least %d bytes, got %d", fieldName, chacha20poly1305.NonceSizeX, len(ciphertext))
	}

	aead, err := chacha20poly1305.NewX(key[:chacha20poly1305.KeySize])
	if err != nil {
		return nil, fmt.Errorf("failed to initialize %s cipher: %w", fieldName, err)
	}

	nonce := ciphertext[:chacha20poly1305.NonceSizeX]
	encryptedData := ciphertext[chacha20poly1305.NonceSizeX:]
	plaintext, err := aead.Open(nil, nonce, encryptedData, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt %s: %w", fieldName, err)
	}

	return plaintext, nil
}

func normalizeLocalState(state State) (normalizedState, error) {
	return normalizeState(state, "local")
}

func normalizeRemoteState(state State) (normalizedState, error) {
	return normalizeState(state, "remote")
}

func normalizeState(state State, source string) (normalizedState, error) {
	normalized := normalizedState{
		NotificationServerURL: state.NotificationServerURL,
		Accounts:              make(map[string]mergeAccount, len(state.Accounts)),
		DeletedAccounts:       maps.Clone(state.DeletedAccounts),
		Extra:                 maps.Clone(state.Extra),
	}

	for idx, account := range state.Accounts {
		if len(account.Seed) != ed25519.SeedSize {
			return normalizedState{}, fmt.Errorf("%s account %d has invalid seed length: got %d, expected %d", source, idx, len(account.Seed), ed25519.SeedSize)
		}

		kp := core.NewKeyPair(ed25519.NewKeyFromSeed(account.Seed))
		principal := kp.Principal().String()
		normalizedDelegations, err := normalizeRemoteDelegations(account.Delegations)
		if err != nil {
			return normalizedState{}, fmt.Errorf("%s account %d has invalid delegations: %w", source, idx, err)
		}

		name := normalizeKeyName(account.Name, principal)
		next := mergeAccount{
			Principal: principal,
			Account: AccountInfo{
				Name:        name,
				Seed:        bytes.Clone(account.Seed),
				CreateTime:  account.CreateTime,
				Delegations: normalizedDelegations,
				Extra:       maps.Clone(account.Extra),
			},
			KeyPair: kp,
		}

		existing, ok := normalized.Accounts[principal]
		if !ok {
			normalized.Accounts[principal] = next
			continue
		}

		resolved, err := mergeDuplicateAccount(source, principal, existing, next)
		if err != nil {
			return normalizedState{}, err
		}
		normalized.Accounts[principal] = resolved
	}

	return normalized, nil
}

func statesEqual(left State, right State) (bool, error) {
	leftNormalized, err := normalizeLocalState(left)
	if err != nil {
		return false, err
	}
	rightNormalized, err := normalizeRemoteState(right)
	if err != nil {
		return false, err
	}
	return normalizedStatesEqual(leftNormalized, rightNormalized)
}

func normalizedStatesEqual(left normalizedState, right normalizedState) (bool, error) {
	if left.NotificationServerURL != right.NotificationServerURL {
		return false, nil
	}
	if !equalDeletedAccounts(left.DeletedAccounts, right.DeletedAccounts) {
		return false, nil
	}
	if !cborValuesEqual(left.Extra, right.Extra) {
		return false, nil
	}
	if len(left.Accounts) != len(right.Accounts) {
		return false, nil
	}

	for name, leftAccount := range left.Accounts {
		rightAccount, ok := right.Accounts[name]
		if !ok {
			return false, nil
		}

		keyMatch, err := keyPairsEqual(leftAccount.KeyPair, rightAccount.KeyPair)
		if err != nil {
			return false, err
		}
		if !keyMatch || !cborValuesEqual(leftAccount.Account, rightAccount.Account) {
			return false, nil
		}
	}

	return true, nil
}

func keyPairsEqual(left *core.KeyPair, right *core.KeyPair) (bool, error) {
	leftBinary, err := left.MarshalBinary()
	if err != nil {
		return false, err
	}
	rightBinary, err := right.MarshalBinary()
	if err != nil {
		return false, err
	}

	return subtle.ConstantTimeCompare(leftBinary, rightBinary) == 1, nil
}

func accountWinsByTiebreak(current mergeAccount, candidate mergeAccount) bool {
	if candidate.Account.CreateTime > current.Account.CreateTime {
		return true
	}
	if candidate.Account.CreateTime < current.Account.CreateTime {
		return false
	}
	if candidate.Principal > current.Principal {
		return true
	}
	if candidate.Principal < current.Principal {
		return false
	}

	return candidate.Account.Name > current.Account.Name
}

func mergeDuplicateAccount(source string, accountID string, existing mergeAccount, candidate mergeAccount) (mergeAccount, error) {
	keyMatch, err := keyPairsEqual(existing.KeyPair, candidate.KeyPair)
	if err != nil {
		return mergeAccount{}, fmt.Errorf("failed to compare %s duplicate account %q key material: %w", source, accountID, err)
	}
	if keyMatch {
		mergedDelegations, mergeErr := mergeRemoteDelegations(existing.Account.Delegations, candidate.Account.Delegations)
		if mergeErr != nil {
			return mergeAccount{}, fmt.Errorf("failed to merge %s delegations for account %q: %w", source, accountID, mergeErr)
		}
		if accountWinsByTiebreak(existing, candidate) {
			candidate.Account.Delegations = mergedDelegations
			return candidate, nil
		}

		existing.Account.Delegations = mergedDelegations
		return existing, nil
	}

	if accountWinsByTiebreak(existing, candidate) {
		return candidate, nil
	}

	return existing, nil
}

func mergeRemoteDelegations(left []DelegationInfo, right []DelegationInfo) ([]DelegationInfo, error) {
	combined := make([]DelegationInfo, 0, len(left)+len(right))
	combined = append(combined, left...)
	combined = append(combined, right...)
	return normalizeRemoteDelegations(combined)
}

func mergeMatchingAccounts(local AccountInfo, remote AccountInfo) (AccountInfo, error) {
	mergedDelegations, err := mergeRemoteDelegations(local.Delegations, remote.Delegations)
	if err != nil {
		return AccountInfo{}, err
	}

	merged := remote
	merged.Name = local.Name
	if merged.Name == "" {
		merged.Name = remote.Name
	}
	if len(local.Seed) > 0 {
		merged.Seed = bytes.Clone(local.Seed)
	}
	merged.CreateTime = max(local.CreateTime, remote.CreateTime)
	merged.Delegations = mergedDelegations
	merged.Extra = maps.Clone(remote.Extra)
	for key, value := range local.Extra {
		if merged.Extra == nil {
			merged.Extra = map[string]any{}
		}
		merged.Extra[key] = value
	}

	return merged, nil
}

func normalizeRemoteDelegations(delegations []DelegationInfo) ([]DelegationInfo, error) {
	if len(delegations) == 0 {
		return nil, nil
	}

	byCID := make(map[string]DelegationInfo, len(delegations))
	for idx, delegation := range delegations {
		cidKey, err := delegationCapabilityCIDKey(delegation)
		if err != nil {
			return nil, fmt.Errorf("delegation %d: %w", idx, err)
		}

		existing, ok := byCID[cidKey]
		if !ok || delegationWinsByTiebreak(existing, delegation) {
			byCID[cidKey] = delegation
		}
	}

	keys := make([]string, 0, len(byCID))
	for key := range byCID {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	normalized := make([]DelegationInfo, 0, len(keys))
	for _, key := range keys {
		normalized = append(normalized, byCID[key])
	}

	return normalized, nil
}

func delegationWinsByTiebreak(current DelegationInfo, candidate DelegationInfo) bool {
	if candidate.CreateTime > current.CreateTime {
		return true
	}
	if candidate.CreateTime < current.CreateTime {
		return false
	}
	if candidate.ClientID > current.ClientID {
		return true
	}
	if candidate.ClientID < current.ClientID {
		return false
	}

	return candidate.DeviceType > current.DeviceType
}

func delegationCapabilityCIDKey(delegation DelegationInfo) (string, error) {
	if !delegation.Capability.CID.Defined() {
		return "", fmt.Errorf("delegation capability CID is missing")
	}

	encodedCID, err := cbornode.DumpObject(delegation.Capability.CID)
	if err != nil {
		return "", fmt.Errorf("failed to encode delegation capability CID: %w", err)
	}

	return base64.RawURLEncoding.EncodeToString(encodedCID), nil
}

func mergeNormalizedStates(
	local normalizedState,
	remote normalizedState,
	localVersion int,
	remoteVersion int,
) (State, bool, error) {
	merged := State{
		SchemaVersion:         stateSchemaVersion,
		NotificationServerURL: chooseMergedNotificationServerURL(local.NotificationServerURL, remote.NotificationServerURL, localVersion, remoteVersion),
		Accounts:              []AccountInfo{},
		DeletedAccounts:       maps.Clone(local.DeletedAccounts),
		Extra:                 maps.Clone(remote.Extra),
	}
	for key, value := range local.Extra {
		if merged.Extra == nil {
			merged.Extra = map[string]any{}
		}
		merged.Extra[key] = value
	}
	if merged.DeletedAccounts == nil {
		merged.DeletedAccounts = map[string]int64{}
	}
	for accountID, deleteTime := range remote.DeletedAccounts {
		if merged.DeletedAccounts[accountID] < deleteTime {
			merged.DeletedAccounts[accountID] = deleteTime
		}
	}

	accountIDs := map[string]struct{}{}
	for accountID := range local.Accounts {
		accountIDs[accountID] = struct{}{}
	}
	for accountID := range remote.Accounts {
		accountIDs[accountID] = struct{}{}
	}
	for accountID := range merged.DeletedAccounts {
		accountIDs[accountID] = struct{}{}
	}

	accountIDsList := make([]string, 0, len(accountIDs))
	for accountID := range accountIDs {
		accountIDsList = append(accountIDsList, accountID)
	}
	sort.Strings(accountIDsList)

	for _, accountID := range accountIDsList {
		localAccount, hasLocal := local.Accounts[accountID]
		remoteAccount, hasRemote := remote.Accounts[accountID]
		localTombstone := local.DeletedAccounts[accountID]
		remoteTombstone := remote.DeletedAccounts[accountID]
		winningTombstone := max(localTombstone, remoteTombstone)
		var latestLiveCreateTime int64
		if hasLocal && localAccount.Account.CreateTime > latestLiveCreateTime {
			latestLiveCreateTime = localAccount.Account.CreateTime
		}
		if hasRemote && remoteAccount.Account.CreateTime > latestLiveCreateTime {
			latestLiveCreateTime = remoteAccount.Account.CreateTime
		}
		if winningTombstone >= latestLiveCreateTime && winningTombstone > 0 {
			merged.DeletedAccounts[accountID] = winningTombstone
			continue
		}

		delete(merged.DeletedAccounts, accountID)
		if !hasLocal && !hasRemote {
			continue
		}

		var next AccountInfo
		switch {
		case hasLocal && hasRemote:
			keyMatch, err := keyPairsEqual(localAccount.KeyPair, remoteAccount.KeyPair)
			if err != nil {
				return State{}, false, fmt.Errorf("failed to compare remote account %q key material: %w", accountID, err)
			}
			if keyMatch {
				next, err = mergeMatchingAccounts(localAccount.Account, remoteAccount.Account)
				if err != nil {
					return State{}, false, fmt.Errorf("failed to merge account %q: %w", accountID, err)
				}
				break
			}

			if accountWinsByTiebreak(localAccount, remoteAccount) {
				next = remoteAccount.Account
			} else {
				next = localAccount.Account
			}
		case hasLocal:
			next = localAccount.Account
		case hasRemote:
			next = remoteAccount.Account
		}

		merged.Accounts = append(merged.Accounts, AccountInfo(next))
	}

	sort.Slice(merged.Accounts, func(i, j int) bool {
		if merged.Accounts[i].Name != merged.Accounts[j].Name {
			return merged.Accounts[i].Name < merged.Accounts[j].Name
		}

		leftPrincipal, err := principalStringFromSeed(merged.Accounts[i].Seed)
		if err != nil {
			return false
		}
		rightPrincipal, err := principalStringFromSeed(merged.Accounts[j].Seed)
		if err != nil {
			return true
		}

		return leftPrincipal < rightPrincipal
	})

	mergedNormalized, err := normalizeLocalState(merged)
	if err != nil {
		return State{}, false, err
	}
	changed, err := normalizedStatesEqual(local, mergedNormalized)
	if err != nil {
		return State{}, false, err
	}
	return merged, !changed, nil
}

func chooseMergedNotificationServerURL(local string, remote string, localVersion int, remoteVersion int) string {
	if remoteVersion > localVersion {
		return remote
	}
	if localVersion > remoteVersion {
		return local
	}
	if local != "" || remote == "" {
		return local
	}

	return remote
}

func normalizeKeyName(name string, principal string) string {
	normalized := strings.TrimSpace(name)
	if normalized == "" || !localKeyNameFormat.MatchString(normalized) {
		return principal
	}

	return normalized
}

func equalDeletedAccounts(left map[string]int64, right map[string]int64) bool {
	if len(left) != len(right) {
		return false
	}
	for name, leftValue := range left {
		if right[name] != leftValue {
			return false
		}
	}
	return true
}

func cborValuesEqual(left any, right any) bool {
	leftEncoded, err := cbornode.DumpObject(left)
	if err != nil {
		return false
	}
	rightEncoded, err := cbornode.DumpObject(right)
	if err != nil {
		return false
	}
	return bytes.Equal(leftEncoded, rightEncoded)
}

// IsConnected reports whether the vault has an active remote connection.
func (ks *Vault) IsConnected() bool {
	status, err := ks.Status()
	if err != nil {
		return false
	}
	return status.RemoteMode && strings.TrimSpace(status.RemoteURL) != ""
}

// ForceSyncNow triggers an immediate sync with the remote vault.
func (ks *Vault) ForceSyncNow(ctx context.Context) error {
	return ks.syncRemote(ctx)
}
