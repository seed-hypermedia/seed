package vault

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"seed/backend/core"

	cid "github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/hkdf"
)

const (
	testRemoteUserID       = "user-123"
	testRemoteCredentialID = "cred-1"
)

func testEncodedRemoteCredential() string {
	return base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
}

func testEncodedRemoteAuthKey(t *testing.T) string {
	t.Helper()

	secret, err := base64.RawURLEncoding.DecodeString(testEncodedRemoteCredential())
	require.NoError(t, err)

	authKey := make([]byte, chacha20poly1305.KeySize)
	reader := hkdf.New(sha256.New, secret, nil, []byte("seed-hypermedia-vault-secret-authentication"))
	_, err = io.ReadFull(reader, authKey)
	require.NoError(t, err)

	return base64.RawURLEncoding.EncodeToString(authKey)
}

func TestRemote(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	remoteURL := "https://example.com/vault"
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	ks, err := New(dataDir, secretStore)
	require.NoError(t, err)
	connectTestRemoteVault(t, ks, remoteURL, 0, time.Time{})

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	kp2, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	keys, err := ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 0)

	require.Error(t, ks.StoreKey(ctx, "invalid name", kp))
	require.Error(t, ks.StoreKey(ctx, "main", nil))

	require.NoError(t, ks.StoreKey(ctx, "main", kp))
	require.Error(t, ks.StoreKey(ctx, "main", kp2))

	got, err := ks.GetKey(ctx, "main")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), got.Principal())

	require.NoError(t, ks.StoreKey(ctx, "second", kp2))
	keyPairs, err := ks.ListKeyPairs(ctx)
	require.NoError(t, err)
	require.Len(t, keyPairs, 2)
	principalsByName := make(map[string]core.Principal, len(keyPairs))
	for _, keyPair := range keyPairs {
		require.NotNil(t, keyPair.KeyPair)
		principalsByName[keyPair.Name] = keyPair.Principal()
	}
	require.Equal(t, map[string]core.Principal{
		"main":   kp.Principal(),
		"second": kp2.Principal(),
	}, principalsByName)
	require.NoError(t, ks.ChangeKeyName(ctx, "main", "renamed"))
	require.NoError(t, ks.DeleteKey(ctx, "renamed"))
	require.NoError(t, ks.DeleteAllKeys(ctx))

	keys, err = ks.ListKeys(ctx)
	require.NoError(t, err)
	require.Len(t, keys, 0)

	envelope, err := load(dataDir)
	require.NoError(t, err)
	require.NotNil(t, envelope)
	require.NotNil(t, envelope.Remote)
	require.Equal(t, remoteURL, envelope.Remote.RemoteURL)
	require.Equal(t, 5, envelope.Remote.LocalVersion)
}

func TestRemoteDeleteKeyRecordsTombstone(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	remoteURL := "https://example.com/vault"
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	ks, err := New(dataDir, secretStore)
	require.NoError(t, err)
	connectTestRemoteVault(t, ks, remoteURL, 0, time.Time{})

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	require.NoError(t, ks.StoreKey(ctx, "main", kp))
	require.NoError(t, ks.DeleteKey(ctx, "main"))
	seed, err := exportedSeed(kp)
	require.NoError(t, err)
	accountID, err := accountIDFromSeed(seed)
	require.NoError(t, err)

	envelope, err := load(dataDir)
	require.NoError(t, err)
	require.NotNil(t, envelope)
	state, err := decodeStateFromEnvelope(t, ks.store, envelope)
	require.NoError(t, err)
	require.Empty(t, state.Accounts)
	require.NotEmpty(t, state.DeletedAccounts)
	require.NotZero(t, state.DeletedAccounts[accountID])
}

func TestRemoteKeepsLocalEnvelopeLocalUntilConnect(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	localSecretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, localSecretStore.Store(localVaultKEKName, keyMaterial))
	local, err := New(dataDir, localSecretStore)
	require.NoError(t, err)
	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	require.NoError(t, local.StoreKey(ctx, "main", kp))

	remoteSecretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, remoteSecretStore.Store(localVaultKEKName, keyMaterial))
	ks, err := New(dataDir, remoteSecretStore)
	require.NoError(t, err)

	got, err := ks.GetKey(ctx, "main")
	require.NoError(t, err)
	require.Equal(t, kp.Principal(), got.Principal())

	kp2, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	require.NoError(t, ks.StoreKey(ctx, "second", kp2))

	envelope, err := load(dataDir)
	require.NoError(t, err)
	require.NotNil(t, envelope)
	require.Nil(t, envelope.Remote)
}

func TestRemoteMergeKeepsNewerDeleteTombstone(t *testing.T) {
	ctx := context.Background()
	dataDir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	remoteURL := "https://example.com/vault"
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	ks, err := New(dataDir, secretStore)
	require.NoError(t, err)
	connectTestRemoteVault(t, ks, remoteURL, 0, time.Time{})

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	require.NoError(t, ks.StoreKey(ctx, "main", kp))
	require.NoError(t, ks.DeleteKey(ctx, "main"))
	seed, err := exportedSeed(kp)
	require.NoError(t, err)
	accountID, err := accountIDFromSeed(seed)
	require.NoError(t, err)

	require.NoError(t, ks.mergeRemoteAccounts(2, 1, State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Name:        "main",
			Seed:        seed,
			CreateTime:  1,
			Delegations: []DelegationInfo{},
		}},
	}))

	envelope, err := load(dataDir)
	require.NoError(t, err)
	require.NotNil(t, envelope)
	state, err := decodeStateFromEnvelope(t, ks.store, envelope)
	require.NoError(t, err)
	require.Empty(t, state.Accounts)
	require.NotZero(t, state.DeletedAccounts[accountID])
}

func TestMergeNormalizedStatesPrefersNewerNotificationServerURL(t *testing.T) {
	local, err := normalizeLocalState(State{
		SchemaVersion:         stateSchemaVersion,
		NotificationServerURL: "https://notify.local.example.com",
		Accounts:              []AccountInfo{},
	})
	require.NoError(t, err)

	remote, err := normalizeRemoteState(State{
		SchemaVersion:         stateSchemaVersion,
		NotificationServerURL: "https://notify.remote.example.com",
		Accounts:              []AccountInfo{},
	})
	require.NoError(t, err)

	merged, changed, err := mergeNormalizedStates(local, remote, 1, 2)
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, "https://notify.remote.example.com", merged.NotificationServerURL)
}

func TestMergeNormalizedStatesDeduplicatesAccountsByPrincipal(t *testing.T) {
	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	seed, err := exportedSeed(kp)
	require.NoError(t, err)

	local, err := normalizeLocalState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Name:        "shared",
			Seed:        seed,
			CreateTime:  1,
			Delegations: []DelegationInfo{},
		}},
	})
	require.NoError(t, err)

	remote, err := normalizeRemoteState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Name:        "renamed",
			Seed:        seed,
			CreateTime:  2,
			Delegations: []DelegationInfo{},
		}},
	})
	require.NoError(t, err)

	merged, changed, err := mergeNormalizedStates(local, remote, 1, 2)
	require.NoError(t, err)
	require.True(t, changed)
	require.Len(t, merged.Accounts, 1)
	require.Equal(t, "shared", merged.Accounts[0].Name)
	require.Equal(t, seed, merged.Accounts[0].Seed)
	require.Equal(t, int64(2), merged.Accounts[0].CreateTime)
}

func TestMergeNormalizedStatesDeletesRenamedAccountByPrincipal(t *testing.T) {
	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	seed, err := exportedSeed(kp)
	require.NoError(t, err)
	accountID, err := accountIDFromSeed(seed)
	require.NoError(t, err)

	local, err := normalizeLocalState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Name:        "renamed",
			Seed:        seed,
			CreateTime:  10,
			Delegations: []DelegationInfo{},
		}},
	})
	require.NoError(t, err)

	remote, err := normalizeRemoteState(State{
		SchemaVersion: stateSchemaVersion,
		DeletedAccounts: map[string]int64{
			accountID: 20,
		},
		Accounts: []AccountInfo{},
	})
	require.NoError(t, err)

	merged, changed, err := mergeNormalizedStates(local, remote, 1, 2)
	require.NoError(t, err)
	require.True(t, changed)
	require.Empty(t, merged.Accounts)
	require.Equal(t, int64(20), merged.DeletedAccounts[accountID])
}

func TestMergeNormalizedStatesKeepsLocalAccountMetadataAcrossRemoteVersionBump(t *testing.T) {
	localKey, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	localSeed, err := exportedSeed(localKey)
	require.NoError(t, err)

	remoteOnlyKey, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	remoteOnlySeed, err := exportedSeed(remoteOnlyKey)
	require.NoError(t, err)

	local, err := normalizeLocalState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Name:        "renamed",
			Seed:        localSeed,
			CreateTime:  1,
			Delegations: []DelegationInfo{},
			Extra: map[string]any{
				"conflict": "local",
				"local":    "value",
			},
		}},
	})
	require.NoError(t, err)

	remote, err := normalizeRemoteState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{
			{
				Name:        "stale-remote-name",
				Seed:        localSeed,
				CreateTime:  1,
				Delegations: []DelegationInfo{},
				Extra: map[string]any{
					"conflict": "remote",
					"remote":   "value",
				},
			},
			{
				Name:        "remote-only",
				Seed:        remoteOnlySeed,
				CreateTime:  2,
				Delegations: []DelegationInfo{},
			},
		},
	})
	require.NoError(t, err)

	merged, changed, err := mergeNormalizedStates(local, remote, 1, 2)
	require.NoError(t, err)
	require.True(t, changed)
	require.Len(t, merged.Accounts, 2)
	require.Equal(t, "remote-only", merged.Accounts[0].Name)
	require.Equal(t, "renamed", merged.Accounts[1].Name)
	require.Equal(t, localSeed, merged.Accounts[1].Seed)
	require.Equal(t, int64(1), merged.Accounts[1].CreateTime)
	require.Equal(t, map[string]any{
		"conflict": "local",
		"local":    "value",
		"remote":   "value",
	}, merged.Accounts[1].Extra)
}

func TestMergeNormalizedStatesMergesMatchingAccountDelegationsByCID(t *testing.T) {
	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	seed, err := exportedSeed(kp)
	require.NoError(t, err)

	delegateA, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	delegateB, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	cidA, err := cid.Decode("bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku")
	require.NoError(t, err)
	cidB, err := cid.Decode("bafyreigx6wfu7t5m3zx6j6ppd4hf6m3r3r4l5xw2l7v6n3wz6n3g5z6x6e")
	require.NoError(t, err)

	local, err := normalizeLocalState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Name:       "renamed-locally",
			Seed:       seed,
			CreateTime: 3,
			Delegations: []DelegationInfo{
				{
					ClientID:   "client-a-local",
					DeviceType: "mobile",
					Capability: CapabilityInfo{
						CID:      cidA,
						Delegate: delegateA.Principal(),
					},
					CreateTime: 10,
				},
			},
		}},
	})
	require.NoError(t, err)

	remote, err := normalizeRemoteState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Name:       "stale-remote-name",
			Seed:       seed,
			CreateTime: 3,
			Delegations: []DelegationInfo{
				{
					ClientID:   "client-a-remote",
					DeviceType: "desktop",
					Capability: CapabilityInfo{
						CID:      cidA,
						Delegate: delegateA.Principal(),
					},
					CreateTime: 20,
				},
				{
					ClientID:   "client-b-remote",
					DeviceType: "desktop",
					Capability: CapabilityInfo{
						CID:      cidB,
						Delegate: delegateB.Principal(),
					},
					CreateTime: 30,
				},
			},
		}},
	})
	require.NoError(t, err)

	merged, changed, err := mergeNormalizedStates(local, remote, 1, 2)
	require.NoError(t, err)
	require.True(t, changed)
	require.Len(t, merged.Accounts, 1)
	require.Equal(t, "renamed-locally", merged.Accounts[0].Name)
	require.Len(t, merged.Accounts[0].Delegations, 2)
	delegationsByClient := map[string]DelegationInfo{}
	for _, delegation := range merged.Accounts[0].Delegations {
		delegationsByClient[delegation.ClientID] = delegation
	}
	require.Contains(t, delegationsByClient, "client-a-remote")
	require.Contains(t, delegationsByClient, "client-b-remote")
}

func TestRemotePreservesSyncMetadataAndBumpsLocalVersion(t *testing.T) {
	dataDir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	remoteURL := "https://example.com/vault"
	remoteCredential, err := base64.RawURLEncoding.DecodeString(testEncodedRemoteCredential())
	require.NoError(t, err)
	dek := []byte("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	plaintext, err := encodeState(newEmptyState())
	require.NoError(t, err)
	encryptedData, err := encryptXChaCha20Payload(plaintext, dek, "local vault payload")
	require.NoError(t, err)
	wrappedDEK, err := encryptXChaCha20Payload(dek, remoteCredential, "wrapped DEK")
	require.NoError(t, err)
	require.NoError(t, saveEnvelopeFile(dataDir, &Envelope{
		EncryptedData: encryptedData,
		WrappedDEK:    wrappedDEK,
		Remote: &RemoteState{
			RemoteURL:     remoteURL,
			UserID:        testRemoteUserID,
			CredentialID:  testRemoteCredentialID,
			LocalVersion:  10,
			RemoteVersion: 7,
			LastSyncTime:  1234,
			LastSyncError: "transient",
		},
	}))

	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))
	remoteKEKName, err := remoteVaultKEKName(remoteURL, testRemoteUserID)
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(remoteKEKName, remoteCredential))
	ks, err := New(dataDir, secretStore)
	require.NoError(t, err)

	kp, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)
	seed, err := exportedSeed(kp)
	require.NoError(t, err)

	shouldSync, err := ks.applyMutation(func(state *State) (bool, error) {
		state.Accounts = append(state.Accounts, payloadAccountFromMetadata("main", seed, KeyMetadata{}))
		return true, nil
	})
	require.NoError(t, err)
	require.True(t, shouldSync)

	envelope, err := load(dataDir)
	require.NoError(t, err)
	require.NotNil(t, envelope)
	require.Equal(t, 11, envelope.Remote.LocalVersion)
	require.Equal(t, 7, envelope.Remote.RemoteVersion)
	require.Equal(t, int64(1234), envelope.Remote.LastSyncTime)
	require.Equal(t, "transient", envelope.Remote.LastSyncError)
}

func TestRemoteConnectCreatesEnvelopeWhenMissing(t *testing.T) {
	dataDir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	remoteURL := "https://example.com/vault"
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	ks, err := New(dataDir, secretStore)
	require.NoError(t, err)

	connectTestRemoteVault(t, ks, remoteURL, 7, time.Unix(1234, 0).UTC())

	envelope, err := load(dataDir)
	require.NoError(t, err)
	require.NotNil(t, envelope)
	require.NotNil(t, envelope.Remote)
	require.Equal(t, remoteURL, envelope.Remote.RemoteURL)
	require.Equal(t, 0, envelope.Remote.LocalVersion)
	require.Equal(t, 7, envelope.Remote.RemoteVersion)
	require.Equal(t, int64(1234), envelope.Remote.LastSyncTime)
	require.Empty(t, envelope.Remote.LastSyncError)

	state, err := decodeStateFromEnvelope(t, ks.store, envelope)
	require.NoError(t, err)
	require.Equal(t, newEmptyState(), state)
}

func TestRemoteRecordsSyncFailureWithoutRemoteIsNoop(t *testing.T) {
	dataDir := t.TempDir()
	keyMaterial := []byte("0123456789abcdef0123456789abcdef")
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, keyMaterial))

	ks, err := New(dataDir, secretStore)
	require.NoError(t, err)

	ks.recordSyncFailure("temporary failure")

	envelope, err := load(dataDir)
	require.NoError(t, err)
	require.Nil(t, envelope, "recording a sync failure without a remote connection must not create a vault file")
}

func TestRemoteRejectsInvalidConfiguration(t *testing.T) {
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, []byte("0123456789abcdef0123456789abcdef")))
	_, err = New("relative/path", secretStore)
	require.Error(t, err)
	require.Contains(t, err.Error(), "must be absolute")

	shortSecretStore := newFixedTestSecretStore(map[string][]byte{
		localVaultKEKName: []byte("too-short"),
	})
	_, err = New(t.TempDir(), shortSecretStore)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid local vault KEK length")

	validSecretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, validSecretStore.Store(localVaultKEKName, []byte("0123456789abcdef0123456789abcdef")))
	ks, err := New(t.TempDir(), validSecretStore)
	require.NoError(t, err)

	_, err = ks.StartConnection("", false)
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid vault URL")
}

func TestRemoteGetAllowsLargeFetchResponses(t *testing.T) {
	ctx := context.Background()
	payload := GetVaultResponse{
		EncryptedData: strings.Repeat("a", controlMaxBody+1024),
		RemoteVersion: 7,
		Credentials: []Credential{{
			Kind:         "secret",
			CredentialID: "cred-1",
			WrappedDEK:   "wrapped-dek",
		}},
	}

	responseBody, err := json.Marshal(payload)
	require.NoError(t, err)
	require.Greater(t, len(responseBody), controlMaxBody)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/vault", r.URL.Path)
		require.Equal(t, "Bearer bearer-token", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, err := w.Write(responseBody)
		require.NoError(t, err)
	}))
	defer server.Close()

	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, []byte("0123456789abcdef0123456789abcdef")))
	ks, err := New(t.TempDir(), secretStore, WithHTTPClient(server.Client()))
	require.NoError(t, err)

	got, err := ks.getRemote(ctx, server.URL, "bearer-token", 0)
	require.NoError(t, err)
	require.Equal(t, payload.EncryptedData, got.EncryptedData)
	require.Equal(t, payload.RemoteVersion, got.RemoteVersion)
	require.Equal(t, payload.Credentials, got.Credentials)
}

func TestDecodeRemoteStateUsesAuthenticatedWrappedDEK(t *testing.T) {
	remoteSecret := []byte("0123456789abcdef0123456789abcdef")
	otherSecret := []byte("fedcba9876543210fedcba9876543210")
	dek := []byte("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	encryptedData, err := encodeRemoteState(State(newEmptyState()), dek)
	require.NoError(t, err)

	goodWrappedDEK, err := encryptXChaCha20Payload(dek, remoteSecret, "wrapped DEK")
	require.NoError(t, err)
	wrongWrappedDEK, err := encryptXChaCha20Payload(dek, otherSecret, "wrapped DEK")
	require.NoError(t, err)

	decoded, err := decodeRemoteState(
		base64.RawURLEncoding.EncodeToString(remoteSecret),
		base64.RawURLEncoding.EncodeToString(goodWrappedDEK),
		GetVaultResponse{
			EncryptedData: encryptedData,
			Credentials: []Credential{{
				Kind:         "secret",
				CredentialID: "other-device",
				WrappedDEK:   base64.RawURLEncoding.EncodeToString(wrongWrappedDEK),
			}},
		},
	)
	require.NoError(t, err)
	require.Equal(t, newEmptyState(), State(decoded))
}

func TestDecodeRemoteStateRequiresWrappedDEK(t *testing.T) {
	remoteSecret := []byte("0123456789abcdef0123456789abcdef")
	dek := []byte("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	encryptedData, err := encodeRemoteState(State(newEmptyState()), dek)
	require.NoError(t, err)

	_, err = decodeRemoteState(
		base64.RawURLEncoding.EncodeToString(remoteSecret),
		"",
		GetVaultResponse{EncryptedData: encryptedData},
	)
	require.EqualError(t, err, "wrapped DEK is required")
}

func TestRemoteLoadRemoteSyncConfigLoadsStoredRemoteSecretAfterRestart(t *testing.T) {
	dataDir := t.TempDir()
	localKey := []byte("0123456789abcdef0123456789abcdef")
	remoteURL := "https://example.com/vault"
	secretStore, err := NewMemorySecretStore()
	require.NoError(t, err)
	require.NoError(t, secretStore.Store(localVaultKEKName, localKey))

	ks, err := New(dataDir, secretStore)
	require.NoError(t, err)
	connectTestRemoteVault(t, ks, remoteURL, 7, time.Unix(1234, 0).UTC())

	reopened, err := New(dataDir, secretStore)
	require.NoError(t, err)

	got, enabled, err := reopened.loadRemoteSyncConfig()
	require.NoError(t, err)
	require.True(t, enabled)
	require.Equal(t, remoteURL, got.RemoteURL)
	require.Equal(t, testRemoteUserID, got.UserID)
	require.Equal(t, testRemoteCredentialID, got.CredentialID)
	require.Equal(t, testEncodedRemoteCredential(), got.Credential)
}

func TestResolveRemoteDaemonEndpointURL(t *testing.T) {
	tests := []struct {
		name         string
		remoteURL    string
		endpointPath string
		want         string
	}{
		{
			name:         "root-based vault stays at root",
			remoteURL:    "https://vault.example.com",
			endpointPath: vaultPath,
			want:         "https://vault.example.com/api/vault",
		},
		{
			name:         "path-based vault keeps explicit base path",
			remoteURL:    "https://example.com/custom/base",
			endpointPath: vaultPath,
			want:         "https://example.com/custom/base/api/vault",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveDaemonEndpointURL(tt.remoteURL, tt.endpointPath)
			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestBuildRemoteBearerAuth(t *testing.T) {
	got, err := buildRemoteBearerAuth(testRemoteCredentialID, testEncodedRemoteCredential())
	require.NoError(t, err)
	require.Equal(t, testRemoteCredentialID+":"+testEncodedRemoteAuthKey(t), got)
}

func TestFindCredential(t *testing.T) {
	credential, err := (GetVaultResponse{
		Credentials: []Credential{
			{Kind: "passkey", CredentialID: "passkey-1", WrappedDEK: "ignored"},
			{Kind: "secret", CredentialID: testRemoteCredentialID, WrappedDEK: "wrapped-dek"},
		},
	}).findCredential(testRemoteCredentialID)
	require.NoError(t, err)
	require.Equal(t, Credential{
		Kind:         "secret",
		CredentialID: testRemoteCredentialID,
		WrappedDEK:   "wrapped-dek",
	}, credential)

	_, err = (GetVaultResponse{
		Credentials: []Credential{{Kind: "secret", CredentialID: "other", WrappedDEK: "wrapped-dek"}},
	}).findCredential(testRemoteCredentialID)
	require.EqualError(t, err, `remote vault response is missing secret credential "cred-1"`)
}

func decodeStateFromEnvelope(t *testing.T, store *fileStore, envelope *Envelope) (State, error) {
	t.Helper()

	dek, err := store.loadDataEncryptionKey(envelope)
	if err != nil {
		return State{}, err
	}

	plaintext, err := store.decrypt(envelope.EncryptedData, dek)
	if err != nil {
		return State{}, err
	}

	return decodeState(plaintext)
}

func mustWrapLocalTestDEK(t *testing.T, localKey []byte) []byte {
	t.Helper()

	dek := []byte("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	return mustWrapExplicitTestDEK(t, localKey, dek)
}

func mustWrapExplicitTestDEK(t *testing.T, localKey []byte, dek []byte) []byte {
	t.Helper()

	wrapped, err := encryptXChaCha20Payload(dek, localKey, "wrapped DEK")
	require.NoError(t, err)
	return wrapped
}

func connectTestRemoteVault(t *testing.T, ks *Vault, remoteURL string, remoteVersion int, syncTime time.Time) {
	t.Helper()

	remoteCredential, err := base64.RawURLEncoding.DecodeString(testEncodedRemoteCredential())
	require.NoError(t, err)
	remoteKEKName, err := remoteVaultKEKName(remoteURL, testRemoteUserID)
	require.NoError(t, err)
	require.NoError(t, ks.secretStore.Store(remoteKEKName, remoteCredential))

	dek := []byte("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	wrappedDEK, err := encryptXChaCha20Payload(dek, remoteCredential, "wrapped DEK")
	require.NoError(t, err)

	require.NoError(t, ks.connect(
		remoteURL,
		testRemoteUserID,
		testRemoteCredentialID,
		testEncodedRemoteCredential(),
		base64.RawURLEncoding.EncodeToString(wrappedDEK),
		[]Credential{{
			Kind:         "secret",
			CredentialID: testRemoteCredentialID,
			WrappedDEK:   base64.RawURLEncoding.EncodeToString(wrappedDEK),
		}},
		remoteVersion,
		syncTime,
	))
}
