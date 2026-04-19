package vault

import (
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"seed/backend/core"

	cid "github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/stretchr/testify/require"
)

// compatibilityFixture is a shared cross-language golden case for the vault wire format.
// Each fixture records one logical vault state plus payloads emitted by both the
// TypeScript and Go serializers. Tests on both sides decode both payload variants and
// compare the reconstructed state, rather than requiring byte-for-byte equality, because
// gzip/container details can differ even when the logical vault contents are identical.
type compatibilityFixture struct {
	Name                    string                    `json:"name"`
	State                   compatibilityFixtureState `json:"state"`
	JavaScriptPayloadBase64 string                    `json:"javascriptPayloadBase64"`
	GoPayloadBase64         string                    `json:"goPayloadBase64"`
}

type compatibilityFixtureState struct {
	Version               int                           `json:"version"`
	NotificationServerURL string                        `json:"notificationServerUrl,omitempty"`
	Accounts              []compatibilityFixtureAccount `json:"accounts"`
}

type compatibilityFixtureAccount struct {
	Name        string                           `json:"name,omitempty"`
	SeedHex     string                           `json:"seedHex"`
	CreateTime  int64                            `json:"createTime"`
	Delegations []compatibilityFixtureDelegation `json:"delegations"`
}

type compatibilityFixtureDelegation struct {
	ClientID   string                                   `json:"clientId"`
	DeviceType string                                   `json:"deviceType,omitempty"`
	Capability compatibilityFixtureDelegationCapability `json:"capability"`
	CreateTime int64                                    `json:"createTime"`
}

type compatibilityFixtureDelegationCapability struct {
	CID               string `json:"cid"`
	DelegatePrincipal string `json:"delegatePrincipal"`
}

func TestStateRoundTripPreservesAccounts(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for idx := range seed {
		seed[idx] = byte(idx + 1)
	}

	delegateSeed := make([]byte, ed25519.SeedSize)
	for idx := range delegateSeed {
		delegateSeed[idx] = byte(idx + 51)
	}

	capabilityCID, err := cid.Decode("bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku")
	require.NoError(t, err)

	state := State{
		SchemaVersion:         stateSchemaVersion,
		NotificationServerURL: "https://notify.example.com",
		Accounts: []AccountInfo{
			{
				Name:       "main",
				Seed:       seed,
				CreateTime: 123,
				Delegations: []DelegationInfo{
					{
						ClientID:   "https://example.com",
						DeviceType: "desktop",
						Capability: CapabilityInfo{
							CID:      capabilityCID,
							Delegate: core.NewKeyPair(ed25519.NewKeyFromSeed(delegateSeed)).Principal(),
						},
						CreateTime: 456,
					},
				},
			},
		},
	}

	encoded, err := encodeState(state)
	require.NoError(t, err)

	decoded, err := decodeState(encoded)
	require.NoError(t, err)
	require.Equal(t, state, decoded)
}

func TestStatePreservesUnknownFields(t *testing.T) {
	delegateSeed := bytes.Repeat([]byte{2}, ed25519.SeedSize)
	delegate := core.NewKeyPair(ed25519.NewKeyFromSeed(delegateSeed)).Principal()
	capabilityCID, err := cid.Decode("bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku")
	require.NoError(t, err)

	rawState := map[string]any{
		"version":               stateSchemaVersion,
		"notificationServerUrl": "https://notify.example.com",
		"deletedAccounts": map[string]int64{
			"z6Mkdeleted": 123,
		},
		"accounts": []any{
			map[string]any{
				"name":           "main",
				"seed":           bytes.Repeat([]byte{1}, ed25519.SeedSize),
				"createTime":     int64(10),
				"unknownAccount": "account",
				"delegations": []any{
					map[string]any{
						"clientId":          "https://example.com",
						"deviceType":        "desktop",
						"createTime":        int64(20),
						"unknownDelegation": "delegation",
						"capability": map[string]any{
							"cid":               capabilityCID,
							"delegate":          delegate,
							"unknownCapability": "capability",
						},
					},
				},
			},
		},
	}

	encodedCBOR, err := cbornode.DumpObject(rawState)
	require.NoError(t, err)
	compressed := mustCompressPayload(t, encodedCBOR)

	decoded, err := decodeState(compressed)
	require.NoError(t, err)
	require.Equal(t, "https://notify.example.com", decoded.NotificationServerURL)
	reencoded, err := encodeState(decoded)
	require.NoError(t, err)
	roundTrippedCBOR, err := decompressStatePayload(reencoded)
	require.NoError(t, err)

	var roundTripped map[string]any
	require.NoError(t, cbornode.DecodeInto(roundTrippedCBOR, &roundTripped))
	require.Equal(t, "https://notify.example.com", roundTripped["notificationServerUrl"])
	require.Equal(t, map[string]any{"z6Mkdeleted": 123}, roundTripped["deletedAccounts"])
	accounts, ok := roundTripped["accounts"].([]any)
	require.True(t, ok)
	require.Len(t, accounts, 1)

	account, ok := accounts[0].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "account", account["unknownAccount"])

	delegations, ok := account["delegations"].([]any)
	require.True(t, ok)
	require.Len(t, delegations, 1)
	delegation, ok := delegations[0].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "delegation", delegation["unknownDelegation"])

	capability, ok := delegation["capability"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "capability", capability["unknownCapability"])
	require.IsType(t, cid.Cid{}, capability["cid"])
	require.Equal(t, capabilityCID, capability["cid"])
}

func TestRecordAccountDeletionCreatesTombstone(t *testing.T) {
	state := &State{
		SchemaVersion: stateSchemaVersion,
		Accounts:      []AccountInfo{},
	}

	recordAccountDeletion(state, "z6Mktest1", 1000)
	require.NotNil(t, state.DeletedAccounts)
	require.Equal(t, int64(1000), state.DeletedAccounts["z6Mktest1"])
}

func TestRecordAccountDeletionUpdatesExistingTombstone(t *testing.T) {
	state := &State{
		SchemaVersion: stateSchemaVersion,
		Accounts:      []AccountInfo{},
		DeletedAccounts: map[string]int64{
			"z6Mktest1": 1000,
		},
	}

	// Should not update because existing timestamp is newer
	recordAccountDeletion(state, "z6Mktest1", 500)
	require.Equal(t, int64(1000), state.DeletedAccounts["z6Mktest1"])

	// Should update because new timestamp is newer
	recordAccountDeletion(state, "z6Mktest1", 2000)
	require.Equal(t, int64(2000), state.DeletedAccounts["z6Mktest1"])
}

func TestEncodePayloadDelegationCapabilityMapCIDRoundTripPreservesType(t *testing.T) {
	delegateSeed := bytes.Repeat([]byte{7}, ed25519.SeedSize)
	delegate := core.NewKeyPair(ed25519.NewKeyFromSeed(delegateSeed)).Principal()
	capabilityCID, err := cid.Decode("bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku")
	require.NoError(t, err)

	mapped := encodePayloadDelegationCapabilityMap(CapabilityInfo{
		CID:      capabilityCID,
		Delegate: delegate,
		Extra:    map[string]any{"unknownCapability": "capability"},
	})
	require.Equal(t, "capability", mapped["unknownCapability"])
	require.IsType(t, cid.Cid{}, mapped["cid"])
	require.Equal(t, capabilityCID, mapped["cid"])

	encoded, err := cbornode.DumpObject(mapped)
	require.NoError(t, err)

	var roundTripped map[string]any
	require.NoError(t, cbornode.DecodeInto(encoded, &roundTripped))
	require.Equal(t, "capability", roundTripped["unknownCapability"])
	require.IsType(t, cid.Cid{}, roundTripped["cid"])
	require.Equal(t, capabilityCID, roundTripped["cid"])
}

func TestDelegationCapabilityCIDRoundTripPreservesConcreteType(t *testing.T) {
	delegateSeed := bytes.Repeat([]byte{8}, ed25519.SeedSize)
	delegate := core.NewKeyPair(ed25519.NewKeyFromSeed(delegateSeed)).Principal()
	capabilityCID, err := cid.Decode("bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku")
	require.NoError(t, err)

	capability := CapabilityInfo{
		CID:      capabilityCID,
		Delegate: delegate,
		Extra:    map[string]any{"unknownCapability": "capability"},
	}

	encoded, err := cbornode.DumpObject(capability)
	require.NoError(t, err)

	var opaque map[string]any
	require.NoError(t, cbornode.DecodeInto(encoded, &opaque))
	require.Equal(t, "capability", opaque["unknownCapability"])
	require.IsType(t, cid.Cid{}, opaque["cid"])
	require.Equal(t, capabilityCID, opaque["cid"])

	var decoded CapabilityInfo
	require.NoError(t, cbornode.DecodeInto(encoded, &decoded))
	require.Equal(t, capability, decoded)
	require.Equal(t, capabilityCID, decoded.CID)
}

func TestStateDecodeBackfillsMissingAccountName(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for idx := range seed {
		seed[idx] = byte(100 + idx)
	}

	encoded, err := encodeState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Seed:        seed,
			CreateTime:  123,
			Delegations: []DelegationInfo{},
		}},
	})
	require.NoError(t, err)

	decoded, err := decodeState(encoded)
	require.NoError(t, err)
	require.Len(t, decoded.Accounts, 1)

	expectedPrincipal := core.NewKeyPair(ed25519.NewKeyFromSeed(seed)).Principal().String()
	require.Equal(t, expectedPrincipal, decoded.Accounts[0].Name)
}

func TestStateEncodeBackfillsMissingAccountName(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for idx := range seed {
		seed[idx] = byte(150 + idx)
	}

	encoded, err := encodeState(State{
		SchemaVersion: stateSchemaVersion,
		Accounts: []AccountInfo{{
			Seed:        seed,
			CreateTime:  123,
			Delegations: []DelegationInfo{},
		}},
	})
	require.NoError(t, err)

	raw, err := decompressStatePayload(encoded)
	require.NoError(t, err)

	var decoded map[string]any
	require.NoError(t, cbornode.DecodeInto(raw, &decoded))

	accounts, ok := decoded["accounts"].([]any)
	require.True(t, ok)
	require.Len(t, accounts, 1)

	account, ok := accounts[0].(map[string]any)
	require.True(t, ok)

	expectedPrincipal := core.NewKeyPair(ed25519.NewKeyFromSeed(seed)).Principal().String()
	require.Equal(t, expectedPrincipal, account["name"])
}

func TestStateCompatibilityFixturesDecodeJavaScriptPayloads(t *testing.T) {
	fixtures := loadCompatibilityFixtures(t)

	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			expected := fixture.expectedState(t)
			payload, err := base64.StdEncoding.DecodeString(fixture.JavaScriptPayloadBase64)
			require.NoError(t, err)

			decoded, err := decodeState(payload)
			require.NoError(t, err)
			require.Equal(t, expected, decoded)

			reencoded, err := encodeState(decoded)
			require.NoError(t, err)
			roundTripped, err := decodeState(reencoded)
			require.NoError(t, err)
			require.Equal(t, expected, roundTripped)
		})
	}
}

func TestStateCompatibilityFixturesDecodeGoPayloads(t *testing.T) {
	fixtures := loadCompatibilityFixtures(t)

	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			expected := fixture.expectedState(t)
			payload, err := base64.StdEncoding.DecodeString(fixture.GoPayloadBase64)
			require.NoError(t, err)

			decoded, err := decodeState(payload)
			require.NoError(t, err)
			require.Equal(t, expected, decoded)
		})
	}
}

func loadCompatibilityFixtures(t *testing.T) []compatibilityFixture {
	t.Helper()

	wd, err := os.Getwd()
	require.NoError(t, err)

	root := findModuleRoot(wd)
	require.NotEmpty(t, root, "could not find module root from %s", wd)

	path := filepath.Join(root, "testdata", "vault-compatibility-fixtures.json")
	raw, err := os.ReadFile(path)
	require.NoError(t, err)

	var fixtures []compatibilityFixture
	require.NoError(t, json.Unmarshal(raw, &fixtures))
	require.NotEmpty(t, fixtures)

	return fixtures
}

func findModuleRoot(dir string) string {
	if dir == "" {
		panic("dir not set")
	}
	dir = filepath.Clean(dir)

	// Look for enclosing go.mod.
	for {
		if fi, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil && !fi.IsDir() {
			return dir
		}
		d := filepath.Dir(dir)
		if d == dir {
			break
		}
		dir = d
	}
	return ""
}

func mustCompressPayload(t *testing.T, payload []byte) []byte {
	t.Helper()

	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	_, err := zw.Write(payload)
	require.NoError(t, err)
	require.NoError(t, zw.Close())
	return compressed.Bytes()
}

func (fixture compatibilityFixture) expectedState(t *testing.T) State {
	t.Helper()

	state := State{
		SchemaVersion:         stateSchemaVersion,
		NotificationServerURL: fixture.State.NotificationServerURL,
		Accounts:              make([]AccountInfo, 0, len(fixture.State.Accounts)),
	}

	for idx, accountFixture := range fixture.State.Accounts {
		seed, err := hex.DecodeString(accountFixture.SeedHex)
		require.NoError(t, err)

		account := AccountInfo{
			Name:        accountFixture.Name,
			Seed:        seed,
			CreateTime:  accountFixture.CreateTime,
			Delegations: make([]DelegationInfo, 0, len(accountFixture.Delegations)),
		}
		if account.Name == "" {
			account.Name, err = principalStringFromSeed(seed)
			require.NoError(t, err, "fixture %s account %d must have a valid principal fallback", fixture.Name, idx)
		}

		for _, delegationFixture := range accountFixture.Delegations {
			capabilityCID, err := cid.Decode(delegationFixture.Capability.CID)
			require.NoError(t, err)
			delegate, err := core.DecodePrincipal(delegationFixture.Capability.DelegatePrincipal)
			require.NoError(t, err)

			account.Delegations = append(account.Delegations, DelegationInfo{
				ClientID:   delegationFixture.ClientID,
				DeviceType: delegationFixture.DeviceType,
				Capability: CapabilityInfo{
					CID:      capabilityCID,
					Delegate: delegate,
				},
				CreateTime: delegationFixture.CreateTime,
			})
		}

		state.Accounts = append(state.Accounts, account)
	}

	return state
}

type fixedTestSecretStore struct {
	secrets map[string][]byte
}

func newFixedTestSecretStore(secrets map[string][]byte) SecretStore {
	cloned := make(map[string][]byte, len(secrets))
	for name, secret := range secrets {
		cloned[name] = append([]byte(nil), secret...)
	}

	return fixedTestSecretStore{secrets: cloned}
}

func (s fixedTestSecretStore) Load(name string) ([]byte, error) {
	secret, ok := s.secrets[name]
	if !ok {
		return nil, fmt.Errorf("missing secret %q", name)
	}

	return append([]byte(nil), secret...), nil
}

func (s fixedTestSecretStore) Ensure(name string) ([]byte, error) {
	return s.Load(name)
}

func (s fixedTestSecretStore) Store(name string, secret []byte) error {
	s.secrets[name] = append([]byte(nil), secret...)
	return nil
}

func (s fixedTestSecretStore) Delete(name string) error {
	delete(s.secrets, name)
	return nil
}
