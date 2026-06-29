package vault

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
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
	"github.com/zalando/go-keyring"
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
func New(dataDir string, secretStore SecretStore, opts ...RemoteOption) (v *Vault, err error) {
	v = &Vault{
		secretStore:  secretStore,
		httpClient:   defaultRemoteHTTPClient(),
		pollInterval: defaultPollInterval,
		pollTimeout:  defaultPollTimeout,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(v)
		}
	}
	if v.httpClient == nil {
		v.httpClient = defaultRemoteHTTPClient()
	}
	v.store, err = newFileStore(dataDir, v.secretStore)
	if err != nil {
		return nil, err
	}

	if err := v.migrateLegacyCredentialRecords(); err != nil {
		return nil, err
	}

	return v, nil
}

func (ks *Vault) migrateLegacyCredentialRecords() error {
	if err := ks.migrateLegacyLocalCredentialRecord(); err != nil {
		return err
	}
	if err := ks.migrateLegacyRemoteCredentialRecord(); err != nil {
		return err
	}
	return nil
}

func (ks *Vault) migrateLegacyLocalCredentialRecord() error {
	localSecret, err := ks.secretStore.Load(localVaultKEKName, "")
	if err != nil {
		return fmt.Errorf("failed to load local vault KEK for credential migration: %w", err)
	}
	if len(localSecret) != vaultSecretSize {
		return fmt.Errorf("invalid local vault KEK length: got %d bytes", len(localSecret))
	}
	if err := ks.secretStore.Store(localVaultKEKName, "", localSecret); err != nil {
		return fmt.Errorf("failed to upgrade local credential record: %w", err)
	}
	return nil
}

func (ks *Vault) migrateLegacyRemoteCredentialRecord() error {
	envelope, err := ks.store.LoadEnvelope()
	if err != nil {
		return fmt.Errorf("failed to load vault envelope for remote credential migration: %w", err)
	}
	if envelope == nil || envelope.Remote == nil {
		return nil
	}

	remote := envelope.Remote
	remoteKey, err := remoteVaultKEKName(remote.VaultURL, remote.UserID)
	if err != nil {
		return err
	}

	credentialID := strings.TrimSpace(remote.CredentialID)
	if credentialID == "" {
		return fmt.Errorf("remote vault credential ID is required for remote credential migration")
	}

	// First try the current format. A successful load means the keychain
	// record is already a bundle and already contains the credential that
	// vault.json points at.
	_, err = ks.secretStore.Load(remoteKey, credentialID)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errLegacyRemoteCredentialRecord):
	default:
		return fmt.Errorf("failed to load remote credential %q: %w", credentialID, err)
	}

	// Loading a non-empty credential ID from a legacy record reports
	// errLegacyRemoteCredentialRecord. The same key with the empty credential
	// ID is the compatibility read for the old raw base64 secret.
	legacySecret, err := ks.secretStore.Load(remoteKey, "")
	if err != nil {
		return fmt.Errorf("failed to load legacy remote vault secret: %w", err)
	}
	if len(legacySecret) != vaultSecretSize {
		return fmt.Errorf("invalid legacy remote secret length: got %d bytes", len(legacySecret))
	}

	// Do not rewrite the keychain just because a legacy-shaped value exists.
	// The only safe upgrade is one where the legacy secret unwraps the DEK,
	// decrypts the current vault payload, and the plaintext decodes as a vault
	// state. If any of those checks fail, startup fails and no keychain write
	// happens.
	dek, err := decryptXChaCha20Payload(envelope.WrappedDEK, legacySecret, "wrapped DEK")
	if err != nil {
		return fmt.Errorf("failed to verify legacy remote vault secret: %w", err)
	}
	plaintext, err := ks.store.decrypt(envelope.EncryptedData, dek)
	if err != nil {
		return fmt.Errorf("failed to verify legacy remote vault payload: %w", err)
	}
	if _, err := decodeState(plaintext); err != nil {
		return fmt.Errorf("failed to verify legacy remote vault state: %w", err)
	}

	if err := ks.secretStore.Store(remoteKey, credentialID, legacySecret); err != nil {
		return fmt.Errorf("failed to upgrade legacy remote credential record: %w", err)
	}

	return nil
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
	// defaultRemoteSyncInterval is how often the daemon pulls/pushes the remote
	// vault in the background so it stays in sync without manual action.
	defaultRemoteSyncInterval = 30 * time.Second

	vaultPath            = "api/vault"
	vaultConnectPath     = "api/vault-connect"
	secretCredentialPath = "api/credentials/secret"
)

var (
	errRemoteWriteConflict = errors.New("remote vault write conflict")
)

var (
	// ErrInvalidRemoteURL reports that the remote vault URL is invalid.
	ErrInvalidRemoteURL = errors.New("invalid vault URL")
	// ErrAlreadyConnected reports that the remote vault is already connected.
	ErrAlreadyConnected = errors.New("remote vault is already connected")
	// ErrConnectionInProgress reports that a vault connection is already in progress.
	ErrConnectionInProgress = errors.New("vault connection is already in progress")
	// ErrConnectionTokenExpired reports that the browser connect token expired.
	ErrConnectionTokenExpired = errors.New("vault connect token expired")
	// ErrConnectionTokenInvalid reports that the browser connect token is invalid.
	ErrConnectionTokenInvalid = errors.New("vault connect token is invalid")
	// ErrConnectionRemoteURLMismatch reports that the Vault Connect targeted a different remote vault URL.
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
	ConnectToken string
	ExpireTime   time.Time
}

// ConnectPayload is the one-time Vault Connect response.
type ConnectPayload struct {
	RemoteURL    string `json:"vaultUrl"`
	UserID       string `json:"userId"`
	CredentialID string `json:"credentialId"`
	Credential   string `json:"secret"`
}

// ConnectionProbe describes whether an existing remote credential completed a Vault Connect.
type ConnectionProbe struct {
	Connected bool
}

type connectionState struct {
	remoteURL  string
	secret     string
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

func loadRemoteCredentialSecret(secretStore SecretStore, remoteURL string, userID string, credentialID string) ([]byte, error) {
	if secretStore == nil {
		return nil, fmt.Errorf("vault KEK store is required")
	}
	key, err := remoteVaultKEKName(remoteURL, userID)
	if err != nil {
		return nil, err
	}
	secret, err := secretStore.Load(key, credentialID)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) || errors.Is(err, errLegacyRemoteCredentialRecord) {
			return nil, fmt.Errorf("%w: %q", ErrRemoteCredentialNotFound, credentialID)
		}
		return nil, err
	}
	if len(secret) != vaultSecretSize {
		return nil, fmt.Errorf("invalid remote secret length: got %d bytes", len(secret))
	}

	return secret, nil
}

type saveRequest struct {
	EncryptedData   string `json:"encryptedData"`
	ExpectedVersion int    `json:"version"`
}

type saveResponse struct {
	Success bool `json:"success"`
}

type vaultConnectResponse struct {
	Found   bool   `json:"found"`
	Payload string `json:"payload"`
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

func validateLocalKeyName(name string, kp *core.KeyPair) error {
	if !localKeyNameFormat.MatchString(name) {
		return fmt.Errorf("invalid name format")
	}
	if principal, err := core.DecodePrincipal(name); err == nil && !principal.Equal(kp.Principal()) {
		return fmt.Errorf("key name parses as a different public key")
	}
	return nil
}

// ResumeRemoteConnection refreshes remote sync state for an already-connected vault.
func (ks *Vault) ResumeRemoteConnection() {
	go ks.syncRemoteMaybe(context.Background())
}

// StartPeriodicRemoteSync runs a background sync on the given interval until ctx
// is cancelled, keeping the local vault in sync with the remote without manual
// action. Each tick is a no-op unless the vault is connected to a remote, and
// syncs are serialized, so this is safe to start unconditionally.
func (ks *Vault) StartPeriodicRemoteSync(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = defaultRemoteSyncInterval
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				ks.syncRemoteMaybe(ctx)
			}
		}
	}()
}

// SetPendingConnectionExpiry rewrites the current pending Vault Connect expiry.
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

	account, ok, err := findAccountByNameOrPrincipal(state.Accounts, name)
	if err != nil {
		return nil, err
	}
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
	if err := validateLocalKeyName(name, kp); err != nil {
		return err
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
		accountIdx, err := findAccountIndexByNameOrPrincipal(state.Accounts, name)
		if err != nil {
			return false, err
		}
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
	if !localKeyNameFormat.MatchString(newName) {
		return fmt.Errorf("invalid new name format")
	}

	shouldSync, err := ks.applyMutation(func(state *State) (bool, error) {
		accountIdx, err := findAccountIndexByNameOrPrincipal(state.Accounts, currentName)
		if err != nil {
			return false, err
		}
		if accountIdx < 0 {
			return false, errLocalKeyNotFound
		}
		if state.Accounts[accountIdx].Name == newName {
			return false, fmt.Errorf("new name equals current name")
		}
		if _, exists := findAccountByName(state.Accounts, newName); exists {
			return false, fmt.Errorf("name already exists, delete it first")
		}
		kp, err := keyPairFromAccount(state.Accounts[accountIdx])
		if err != nil {
			return false, err
		}
		if err := validateLocalKeyName(newName, kp); err != nil {
			return false, err
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
		status.RemoteURL = envelope.Remote.VaultURL
		status.LocalVersion = envelope.Remote.LocalVersion
		status.RemoteVersion = envelope.Remote.RemoteVersion
		status.LastSyncError = envelope.Remote.LastSyncError
		if envelope.Remote.LastSyncTime > 0 {
			status.LastSyncTime = time.Unix(envelope.Remote.LastSyncTime, 0).UTC()
		}
	}

	return status, nil
}

// StartConnection prepares a browser-mediated remote vault connection.
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

	secret, err := newConnectionToken()
	if err != nil {
		return ConnectionStart{}, fmt.Errorf("failed to create vault connection token: %w", err)
	}

	state := &connectionState{
		remoteURL:  normalizedRemoteURL,
		secret:     secret,
		expireTime: now.Add(connectionTokenTTL),
	}
	ks.connection = state

	return ConnectionStart{
		RemoteURL:    state.remoteURL,
		ConnectToken: state.secret,
		ExpireTime:   state.expireTime,
	}, nil
}

// HandleConnection finalizes a browser-mediated remote vault connection.
func (ks *Vault) HandleConnection(ctx context.Context, connectToken string, connectPayload ConnectPayload) error {
	normalizedURL, err := normalizeOriginURL(connectPayload.RemoteURL)
	if err != nil {
		return err
	}

	userID := connectPayload.UserID
	if userID == "" {
		return fmt.Errorf("remote vault user ID is required")
	}

	credentialID := connectPayload.CredentialID
	if credentialID == "" {
		return fmt.Errorf("remote credential ID is required")
	}
	if err := ks.validateVaultConnectPayload(connectToken, normalizedURL, time.Now().UTC()); err != nil {
		return err
	}

	encodedSecret := connectPayload.Credential
	var decodedSecret []byte
	if encodedSecret == "" {
		decodedSecret, err = loadRemoteCredentialSecret(ks.secretStore, normalizedURL, userID, credentialID)
		if err != nil {
			return err
		}
		encodedSecret = base64.RawURLEncoding.EncodeToString(decodedSecret)
	} else {
		decodedSecret, err = decodeBase64URLField(encodedSecret, "remote secret")
		if err != nil {
			return err
		}
		if len(decodedSecret) != vaultSecretSize {
			return fmt.Errorf("invalid remote secret length: got %d bytes", len(decodedSecret))
		}
	}

	if err := ks.consumeVaultConnectPayload(connectToken, normalizedURL, time.Now().UTC()); err != nil {
		return err
	}

	return ks.finishConnection(ctx, normalizedURL, userID, credentialID, encodedSecret)
}

// PollConnection waits for a browser to post an encrypted Vault Connect payload
// to the remote server, then decrypts and consumes that payload locally.
func (ks *Vault) PollConnection(ctx context.Context, connectSecret string) error {
	decodedSecret, err := decodeBase64URLField(connectSecret, "connect secret")
	if err != nil {
		return err
	}
	if len(decodedSecret) != connectionTokenRawLength {
		return ErrConnectionTokenInvalid
	}

	ctx, cancel := context.WithTimeout(ctx, ks.pollTimeout)
	defer cancel()

	interval := time.NewTimer(0)
	defer interval.Stop()

	for {
		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return ErrConnectionTokenExpired
			}
			return ctx.Err()
		case <-interval.C:
		}

		remoteURL, err := ks.pendingConnectionRemoteURL(connectSecret, time.Now().UTC())
		if err != nil {
			return err
		}

		connectPayload, found, err := ks.fetchVaultConnectPayload(ctx, remoteURL, decodedSecret)
		if err != nil {
			return err
		}
		if found {
			return ks.HandleConnection(ctx, connectSecret, connectPayload)
		}

		interval.Reset(ks.pollInterval)
	}
}

// ProbeConnectionCredentials tries existing remote credentials and completes Vault Connect if one works.
func (ks *Vault) ProbeConnectionCredentials(ctx context.Context, connectToken string, remoteURL string, userID string) (ConnectionProbe, error) {
	normalizedURL, err := normalizeOriginURL(remoteURL)
	if err != nil {
		return ConnectionProbe{}, err
	}
	if userID == "" {
		return ConnectionProbe{}, fmt.Errorf("remote vault user ID is required")
	}
	if err := ks.validateVaultConnectPayload(connectToken, normalizedURL, time.Now().UTC()); err != nil {
		return ConnectionProbe{}, err
	}

	key, err := remoteVaultKEKName(normalizedURL, userID)
	if err != nil {
		return ConnectionProbe{}, err
	}
	credentialIDs, err := ks.secretStore.ListCredentialIDs(key)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) || errors.Is(err, errLegacyRemoteCredentialRecord) {
			return ConnectionProbe{}, nil
		}
		return ConnectionProbe{}, err
	}

	for _, credentialID := range credentialIDs {
		secret, err := ks.secretStore.Load(key, credentialID)
		if err != nil {
			continue
		}
		if len(secret) != vaultSecretSize {
			continue
		}
		encodedSecret := base64.RawURLEncoding.EncodeToString(secret)
		if !ks.probeConnectionCredential(ctx, normalizedURL, credentialID, encodedSecret) {
			continue
		}
		if err := ks.finishConnection(ctx, normalizedURL, userID, credentialID, encodedSecret); err != nil {
			return ConnectionProbe{}, err
		}
		if err := ks.clearVaultConnectPayload(connectToken, normalizedURL); err != nil {
			return ConnectionProbe{}, err
		}
		return ConnectionProbe{Connected: true}, nil
	}
	return ConnectionProbe{}, nil
}

func (ks *Vault) probeConnectionCredential(ctx context.Context, remoteURL string, credentialID string, secret string) bool {
	bearerAuth, err := buildRemoteBearerAuth(credentialID, secret)
	if err != nil {
		return false
	}
	remoteSnapshot, err := ks.getRemote(ctx, remoteURL, bearerAuth, 0)
	if err != nil {
		return false
	}
	credential, err := remoteSnapshot.findCredential(credentialID)
	if err != nil {
		return false
	}
	if !remoteSnapshot.Unchanged && remoteSnapshot.EncryptedData != "" {
		_, err := decodeRemoteState(secret, credential.WrappedDEK, remoteSnapshot)
		return err == nil
	}
	_, err = decodeRemoteDataEncryptionKey(secret, credential.WrappedDEK)
	return err == nil
}

func (ks *Vault) fetchVaultConnectPayload(ctx context.Context, remoteURL string, connectSecret []byte) (ConnectPayload, bool, error) {
	connectID := vaultConnectIDFromSecret(connectSecret)
	endpoint, err := resolveDaemonEndpointURL(remoteURL, vaultConnectPath+"/"+url.PathEscape(connectID))
	if err != nil {
		return ConnectPayload{}, false, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ConnectPayload{}, false, err
	}

	resp, err := ks.httpClientDo(req)
	if err != nil {
		return ConnectPayload{}, false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ConnectPayload{}, false, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := readRemoteBody(resp.Body, controlMaxBody, "remote vault connect error response")
		return ConnectPayload{}, false, fmt.Errorf("unexpected Vault Connect status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var response vaultConnectResponse
	if err := decodeRemoteJSON(resp.Body, controlMaxBody, "remote vault connect response", &response); err != nil {
		return ConnectPayload{}, false, err
	}
	if !response.Found {
		return ConnectPayload{}, false, nil
	}

	ciphertext, err := decodeBase64URLField(response.Payload, "vault connect payload")
	if err != nil {
		return ConnectPayload{}, false, err
	}
	plaintext, err := decryptXChaCha20Payload(ciphertext, connectSecret, "vault connect payload")
	if err != nil {
		return ConnectPayload{}, false, err
	}

	var connectPayload ConnectPayload
	if err := json.Unmarshal(plaintext, &connectPayload); err != nil {
		return ConnectPayload{}, false, fmt.Errorf("failed to decode vault connect payload: %w", err)
	}
	return connectPayload, true, nil
}

func vaultConnectIDFromSecret(connectSecret []byte) string {
	sum := sha256.Sum256(connectSecret)
	return base64.RawURLEncoding.EncodeToString(sum[:])
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

	snapshot.Envelope.Remote = nil
	snapshot.Envelope.Credentials = nil
	if err := ks.saveSnapshotLocked(snapshot); err != nil {
		return fmt.Errorf("failed to save disconnected vault envelope: %w", err)
	}

	ks.connection = nil
	return nil
}

// DisconnectAndClear clears remote vault metadata/state and resets local vault state without delete tombstones.
func (ks *Vault) DisconnectAndClear() error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if err := ks.saveSnapshotLocked(vaultSnapshot{State: newEmptyState()}); err != nil {
		return fmt.Errorf("failed to clear local vault state: %w", err)
	}

	ks.connection = nil
	return nil
}

// GetVaultNotificationServerURL returns the notification server URL stored in
// the (synced) vault state, or empty when using the default.
func (ks *Vault) GetVaultNotificationServerURL() (string, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	snapshot, err := ks.loadSnapshotLocked()
	if err != nil {
		return "", err
	}
	return snapshot.State.NotificationServerURL, nil
}

// SetVaultNotificationServerURL stores the notification server URL in the vault
// state and schedules a remote sync so it propagates to other devices and the
// web vault.
func (ks *Vault) SetVaultNotificationServerURL(url string) error {
	shouldSync, err := ks.applyMutation(func(state *State) (bool, error) {
		if state.NotificationServerURL == url {
			return false, nil
		}
		state.NotificationServerURL = url
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

func (ks *Vault) consumeVaultConnectPayload(connectToken string, remoteURL string, now time.Time) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if err := ks.validateVaultConnectPayloadLocked(connectToken, remoteURL, now); err != nil {
		return err
	}

	ks.connection = nil
	return nil
}

func (ks *Vault) clearVaultConnectPayload(connectToken string, remoteURL string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if ks.connection == nil {
		return ErrConnectionTokenInvalid
	}
	if subtle.ConstantTimeCompare([]byte(connectToken), []byte(ks.connection.secret)) != 1 {
		return ErrConnectionTokenInvalid
	}
	if ks.connection.remoteURL != remoteURL {
		return fmt.Errorf("%w: expected %s, got %s", ErrConnectionRemoteURLMismatch, ks.connection.remoteURL, remoteURL)
	}
	ks.connection = nil
	return nil
}

func (ks *Vault) validateVaultConnectPayload(connectToken string, remoteURL string, now time.Time) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	return ks.validateVaultConnectPayloadLocked(connectToken, remoteURL, now)
}

func (ks *Vault) pendingConnectionRemoteURL(connectSecret string, now time.Time) (string, error) {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	if ks.connection == nil {
		return "", ErrConnectionTokenInvalid
	}
	if now.After(ks.connection.expireTime) {
		ks.connection = nil
		return "", ErrConnectionTokenExpired
	}
	if subtle.ConstantTimeCompare([]byte(connectSecret), []byte(ks.connection.secret)) != 1 {
		return "", ErrConnectionTokenInvalid
	}

	return ks.connection.remoteURL, nil
}

func (ks *Vault) validateVaultConnectPayloadLocked(connectToken string, remoteURL string, now time.Time) error {
	if ks.connection == nil {
		return ErrConnectionTokenInvalid
	}
	if now.After(ks.connection.expireTime) {
		ks.connection = nil
		return ErrConnectionTokenExpired
	}
	if subtle.ConstantTimeCompare([]byte(connectToken), []byte(ks.connection.secret)) != 1 {
		return ErrConnectionTokenInvalid
	}
	if ks.connection.remoteURL != remoteURL {
		return fmt.Errorf("%w: expected %s, got %s", ErrConnectionRemoteURLMismatch, ks.connection.remoteURL, remoteURL)
	}

	return nil
}

func (ks *Vault) finishConnection(ctx context.Context, remoteURL string, userID string, credentialID string, secret string) error {
	bearerAuth, err := buildRemoteBearerAuth(credentialID, secret)
	if err != nil {
		return fmt.Errorf("failed to derive remote vault bearer auth: %w", err)
	}
	oldCredentialID, oldSecret := ks.currentRemoteCredential(remoteURL, userID, credentialID)

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
	decodedSecret, err := decodeBase64URLField(secret, "remote secret")
	if err != nil {
		return err
	}
	remoteKey, err := remoteVaultKEKName(remoteURL, userID)
	if err != nil {
		return err
	}
	if err := ks.secretStore.Store(remoteKey, credentialID, decodedSecret); err != nil {
		return err
	}
	if err := ks.connect(remoteURL, userID, credentialID, secret, credential.WrappedDEK, credentials, remoteVersion, syncedLocalVersion, time.Now().UTC()); err != nil {
		return fmt.Errorf("failed to persist remote vault connection: %w", err)
	}
	if oldCredentialID != "" && oldSecret != "" {
		ks.cleanupOldRemoteCredential(ctx, remoteURL, userID, oldCredentialID, oldSecret)
	}

	return nil
}

func (ks *Vault) currentRemoteCredential(remoteURL string, userID string, newCredentialID string) (string, string) {
	ks.mu.RLock()
	envelope, err := ks.store.LoadEnvelope()
	ks.mu.RUnlock()
	if err != nil || envelope == nil || envelope.Remote == nil {
		return "", ""
	}
	remote := envelope.Remote
	if remote.VaultURL != remoteURL || remote.UserID != userID || remote.CredentialID == "" || remote.CredentialID == newCredentialID {
		return "", ""
	}

	secret, err := loadRemoteCredentialSecret(ks.secretStore, remote.VaultURL, remote.UserID, remote.CredentialID)
	if err != nil {
		return "", ""
	}
	return remote.CredentialID, base64.RawURLEncoding.EncodeToString(secret)
}

func (ks *Vault) cleanupOldRemoteCredential(ctx context.Context, remoteURL string, userID string, credentialID string, secret string) {
	_ = ks.deleteRemoteSecretCredential(ctx, remoteURL, credentialID, secret)
	_ = ks.deleteLocalRemoteCredentialSecret(remoteURL, userID, credentialID)
	_ = ks.removeRemoteCredentialFromEnvelope(credentialID)
}

func (ks *Vault) deleteRemoteSecretCredential(ctx context.Context, remoteURL string, credentialID string, secret string) error {
	bearerAuth, err := buildRemoteBearerAuth(credentialID, secret)
	if err != nil {
		return fmt.Errorf("failed to derive old remote credential bearer auth: %w", err)
	}
	endpoint, err := resolveDaemonEndpointURL(remoteURL, secretCredentialPath+"/"+url.PathEscape(credentialID))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+bearerAuth)

	resp, err := ks.httpClientDo(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := readRemoteBody(resp.Body, controlMaxBody, "remote credential deletion error response")
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return nil
}

func (ks *Vault) deleteLocalRemoteCredentialSecret(remoteURL string, userID string, credentialID string) error {
	key, err := remoteVaultKEKName(remoteURL, userID)
	if err != nil {
		return err
	}
	if err := ks.secretStore.Delete(key, credentialID); err != nil {
		return fmt.Errorf("failed to delete old local remote credential secret: %w", err)
	}
	return nil
}

func removeCredentialJSON(credentials []Credential, credentialID string) []Credential {
	if credentialID == "" || len(credentials) == 0 {
		return credentials
	}
	out := credentials[:0]
	for _, credential := range credentials {
		if credential.Kind == "secret" && credential.CredentialID == credentialID {
			continue
		}
		out = append(out, credential)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (ks *Vault) removeRemoteCredentialFromEnvelope(credentialID string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	envelope, err := ks.store.LoadEnvelope()
	if err != nil {
		return err
	}
	if envelope == nil {
		return nil
	}
	envelope.Credentials = removeCredentialJSON(envelope.Credentials, credentialID)
	return ks.store.SaveEnvelope(envelope)
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

		remoteSnapshot, err := ks.getRemote(ctx, localRemote.VaultURL, bearerAuth, localRemote.RemoteVersion)
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
			if err := ks.saveRemoteSnapshot(ctx, localRemote.VaultURL, bearerAuth, saveReq); err != nil {
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
	if remote.VaultURL != expectedRemote.VaultURL ||
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
	if envelope == nil || envelope.Remote == nil || strings.TrimSpace(envelope.Remote.VaultURL) == "" {
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
	remoteSecretBytes, err := loadRemoteCredentialSecret(ks.secretStore, remote.VaultURL, remote.UserID, remote.CredentialID)
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

// activeRemoteEmailAuth returns the active remote vault URL and bearer auth for
// user-scoped requests (e.g. email change), or an error if there is no active
// remote vault connection.
func (ks *Vault) activeRemoteEmailAuth() (remoteURL string, bearerAuth string, err error) {
	localRemote, _, remoteSecret, enabled, err := ks.loadRemoteSyncState()
	if err != nil {
		return "", "", err
	}
	if !enabled {
		return "", "", fmt.Errorf("not connected to a remote vault")
	}
	bearerAuth, err = buildRemoteBearerAuth(localRemote.CredentialID, remoteSecret)
	if err != nil {
		return "", "", fmt.Errorf("failed to derive remote vault bearer auth: %w", err)
	}
	return localRemote.VaultURL, bearerAuth, nil
}

// requestRemoteEmail performs an authenticated JSON request to a user-scoped
// vault endpoint using the active remote connection's bearer credential.
func (ks *Vault) requestRemoteEmail(
	ctx context.Context,
	method string,
	endpointPath string,
	remoteURL string,
	bearerAuth string,
	reqBody any,
	out any,
) error {
	endpoint, err := resolveDaemonEndpointURL(remoteURL, endpointPath)
	if err != nil {
		return err
	}

	var bodyReader io.Reader
	if reqBody != nil {
		encoded, marshalErr := json.Marshal(reqBody)
		if marshalErr != nil {
			return marshalErr
		}
		bodyReader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, bodyReader)
	if err != nil {
		return err
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+bearerAuth)

	resp, err := ks.httpClientDo(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := readRemoteBody(resp.Body, controlMaxBody, "remote vault email error response")
		return remoteEmailError(body, resp.StatusCode)
	}
	if out != nil {
		if err := decodeRemoteJSON(resp.Body, controlMaxBody, "remote vault email response", out); err != nil {
			return err
		}
	}
	return nil
}

// remoteEmailError extracts a human-readable error from a vault JSON error body.
func remoteEmailError(body []byte, status int) error {
	var parsed struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &parsed) == nil && strings.TrimSpace(parsed.Error) != "" {
		return fmt.Errorf("%s", strings.TrimSpace(parsed.Error))
	}
	return fmt.Errorf("remote vault email request failed (status %d)", status)
}

// GetVaultEmail returns the current email of the connected remote vault user.
func (ks *Vault) GetVaultEmail(ctx context.Context) (string, error) {
	remoteURL, bearerAuth, err := ks.activeRemoteEmailAuth()
	if err != nil {
		return "", err
	}
	var resp struct {
		Email string `json:"email"`
	}
	if err := ks.requestRemoteEmail(ctx, http.MethodGet, "api/vault-email", remoteURL, bearerAuth, nil, &resp); err != nil {
		return "", err
	}
	return resp.Email, nil
}

// ChangeVaultEmailStart begins a remote vault email change, sending a code to
// the new address. It returns an anti-phishing binding to pass back to verify,
// plus the code expiry and resend-allowed times (Unix milliseconds).
func (ks *Vault) ChangeVaultEmailStart(ctx context.Context, newEmail string) (binding string, expireTimeMs int64, resendAllowedTimeMs int64, err error) {
	remoteURL, bearerAuth, err := ks.activeRemoteEmailAuth()
	if err != nil {
		return "", 0, 0, err
	}
	var resp struct {
		Binding           string `json:"binding"`
		ExpireTime        int64  `json:"expireTime"`
		ResendAllowedTime int64  `json:"resendAllowedTime"`
	}
	reqBody := map[string]string{"newEmail": newEmail}
	if err := ks.requestRemoteEmail(ctx, http.MethodPost, "api/email-change/start", remoteURL, bearerAuth, reqBody, &resp); err != nil {
		return "", 0, 0, err
	}
	return resp.Binding, resp.ExpireTime, resp.ResendAllowedTime, nil
}

// ChangeVaultEmailVerify completes a remote vault email change by submitting the
// emailed code and the binding from ChangeVaultEmailStart. Returns the new email.
func (ks *Vault) ChangeVaultEmailVerify(ctx context.Context, code string, binding string) (string, error) {
	remoteURL, bearerAuth, err := ks.activeRemoteEmailAuth()
	if err != nil {
		return "", err
	}
	var resp struct {
		Verified bool   `json:"verified"`
		NewEmail string `json:"newEmail"`
	}
	reqBody := map[string]string{"code": code, "binding": binding}
	if err := ks.requestRemoteEmail(ctx, http.MethodPost, "api/email-change/verify", remoteURL, bearerAuth, reqBody, &resp); err != nil {
		return "", err
	}
	return resp.NewEmail, nil
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
		VaultURL:           normalizedURL,
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

func decryptXChaCha20Payload(ciphertext []byte, key []byte, errmsg string) ([]byte, error) {
	if len(key) < chacha20poly1305.KeySize {
		return nil, fmt.Errorf("%s decryption key is too short: got %d bytes", errmsg, len(key))
	}
	if len(ciphertext) < chacha20poly1305.NonceSizeX {
		return nil, fmt.Errorf("invalid %s ciphertext: expected at least %d bytes, got %d", errmsg, chacha20poly1305.NonceSizeX, len(ciphertext))
	}

	aead, err := chacha20poly1305.NewX(key[:chacha20poly1305.KeySize])
	if err != nil {
		return nil, fmt.Errorf("failed to initialize %s cipher: %w", errmsg, err)
	}

	nonce := ciphertext[:chacha20poly1305.NonceSizeX]
	encryptedData := ciphertext[chacha20poly1305.NonceSizeX:]
	plaintext, err := aead.Open(nil, nonce, encryptedData, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt %s: %w", errmsg, err)
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
