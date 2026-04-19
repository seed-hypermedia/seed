package vault

import (
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"fmt"
	"io"
	"reflect"
	"seed/backend/core"
	"strings"

	"github.com/go-viper/mapstructure/v2"
	cid "github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/polydawn/refmt/obj/atlas"
)

const (
	stateSchemaVersion  = 2
	statePayloadMaxSize = 64 << 20 // 64 MiB.
)

// State is the decrypted vault payload stored inside the encrypted envelope.
type State struct {
	SchemaVersion         int              `mapstructure:"version"`
	NotificationServerURL string           `mapstructure:"notificationServerUrl,omitempty"`
	Accounts              []AccountInfo    `mapstructure:"accounts"`
	DeletedAccounts       map[string]int64 `mapstructure:"deletedAccounts,omitempty"`
	Extra                 map[string]any   `mapstructure:",remain"`
}

// AccountInfo contains one locally stored account entry.
type AccountInfo struct {
	Name        string           `mapstructure:"name,omitempty"`
	Seed        []byte           `mapstructure:"seed"`
	CreateTime  int64            `mapstructure:"createTime"`
	Delegations []DelegationInfo `mapstructure:"delegations"`
	Extra       map[string]any   `mapstructure:",remain"`
}

// DelegationInfo contains one stored delegation attached to an account.
type DelegationInfo struct {
	ClientID   string         `mapstructure:"clientId"`
	DeviceType string         `mapstructure:"deviceType,omitempty"`
	Capability CapabilityInfo `mapstructure:"capability"`
	CreateTime int64          `mapstructure:"createTime"`
	Extra      map[string]any `mapstructure:",remain"`
}

// CapabilityInfo identifies the delegated capability referenced by a delegation.
type CapabilityInfo struct {
	CID      cid.Cid        `mapstructure:"cid"`
	Delegate core.Principal `mapstructure:"delegate"`
	Extra    map[string]any `mapstructure:",remain"`
}

func init() {
	cbornode.RegisterCborType(atlas.BuildEntry(State{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in State) (map[string]any, error) {
			return encodePayloadStateMap(in), nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (State, error) {
			var out State
			if err := mapstructDecode(in, &out); err != nil {
				return State{}, err
			}
			return out, nil
		})).
		Complete(),
	)
	cbornode.RegisterCborType(atlas.BuildEntry(AccountInfo{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in AccountInfo) (map[string]any, error) {
			return encodePayloadAccountMap(in), nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (AccountInfo, error) {
			var out AccountInfo
			if err := mapstructDecode(in, &out); err != nil {
				return AccountInfo{}, err
			}
			return out, nil
		})).
		Complete(),
	)
	cbornode.RegisterCborType(atlas.BuildEntry(DelegationInfo{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in DelegationInfo) (map[string]any, error) {
			return encodePayloadDelegationMap(in), nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (DelegationInfo, error) {
			var out DelegationInfo
			if err := mapstructDecode(in, &out); err != nil {
				return DelegationInfo{}, err
			}
			return out, nil
		})).
		Complete(),
	)
	cbornode.RegisterCborType(atlas.BuildEntry(CapabilityInfo{}).Transform().
		TransformMarshal(atlas.MakeMarshalTransformFunc(func(in CapabilityInfo) (map[string]any, error) {
			return encodePayloadDelegationCapabilityMap(in), nil
		})).
		TransformUnmarshal(atlas.MakeUnmarshalTransformFunc(func(in map[string]any) (CapabilityInfo, error) {
			var out CapabilityInfo
			if err := mapstructDecode(in, &out); err != nil {
				return CapabilityInfo{}, err
			}
			return out, nil
		})).
		Complete(),
	)
}

func newEmptyState() State {
	return State{SchemaVersion: stateSchemaVersion, Accounts: []AccountInfo{}}
}

func encodeState(state State) ([]byte, error) {
	state.SchemaVersion = stateSchemaVersion
	if state.Accounts == nil {
		state.Accounts = []AccountInfo{}
	}
	for idx := range state.Accounts {
		if strings.TrimSpace(state.Accounts[idx].Name) == "" {
			principal, err := principalStringFromSeed(state.Accounts[idx].Seed)
			if err != nil {
				return nil, fmt.Errorf("account %d is missing a valid name fallback: %w", idx, err)
			}
			state.Accounts[idx].Name = principal
		}
		if state.Accounts[idx].Delegations == nil {
			state.Accounts[idx].Delegations = []DelegationInfo{}
		}
	}

	encodedState, err := cbornode.DumpObject(state)
	if err != nil {
		return nil, fmt.Errorf("failed to encode vault state: %w", err)
	}

	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	if _, err := zw.Write(encodedState); err != nil {
		return nil, fmt.Errorf("failed to compress vault payload: %w", err)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("failed to finalize vault payload compression: %w", err)
	}

	return compressed.Bytes(), nil
}

func decodeState(compressed []byte) (State, error) {
	decodedCBOR, err := decompressStatePayload(compressed)
	if err != nil {
		return State{}, err
	}

	var state State
	if err := cbornode.DecodeInto(decodedCBOR, &state); err != nil {
		return State{}, fmt.Errorf("failed to decode vault state: %w", err)
	}
	if state.SchemaVersion != stateSchemaVersion {
		return State{}, fmt.Errorf("unsupported vault schema version: %d", state.SchemaVersion)
	}

	for idx := range state.Accounts {
		account := &state.Accounts[idx]
		if account.Delegations == nil {
			account.Delegations = []DelegationInfo{}
		}
		if strings.TrimSpace(account.Name) != "" {
			continue
		}

		principal, err := principalStringFromSeed(account.Seed)
		if err != nil {
			return State{}, fmt.Errorf("account %d is missing a valid name fallback: %w", idx, err)
		}
		account.Name = principal
	}
	if state.Accounts == nil {
		state.Accounts = []AccountInfo{}
	}

	return state, nil
}

func decompressStatePayload(compressed []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, fmt.Errorf("failed to create vault gzip reader: %w", err)
	}
	defer reader.Close()

	limited := io.LimitReader(reader, statePayloadMaxSize+1)
	payload, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("failed to decompress vault payload: %w", err)
	}
	if len(payload) > statePayloadMaxSize {
		return nil, fmt.Errorf("vault payload exceeds max size of %d bytes", statePayloadMaxSize)
	}

	return payload, nil
}

func keyPairFromAccount(account AccountInfo) (*core.KeyPair, error) {
	if len(account.Seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("invalid ed25519 seed length: expected %d bytes, got %d", ed25519.SeedSize, len(account.Seed))
	}

	return core.NewKeyPair(ed25519.NewKeyFromSeed(account.Seed)), nil
}

func principalStringFromSeed(seed []byte) (string, error) {
	kp, err := keyPairFromAccount(AccountInfo{Seed: seed})
	if err != nil {
		return "", err
	}

	return kp.Principal().String(), nil
}

func findAccountByName(accounts []AccountInfo, name string) (AccountInfo, bool) {
	for _, account := range accounts {
		if account.Name == name {
			return account, true
		}
	}

	return AccountInfo{}, false
}

func findAccountIndexByName(accounts []AccountInfo, name string) int {
	for idx, account := range accounts {
		if account.Name == name {
			return idx
		}
	}

	return -1
}

func recordAccountDeletion(state *State, accountID string, deleteTime int64) {
	if state == nil || strings.TrimSpace(accountID) == "" || deleteTime == 0 {
		return
	}
	if state.DeletedAccounts == nil {
		state.DeletedAccounts = map[string]int64{}
	}
	if state.DeletedAccounts[accountID] >= deleteTime {
		return
	}
	state.DeletedAccounts[accountID] = deleteTime
}

func accountIDFromSeed(seed []byte) (string, error) {
	return principalStringFromSeed(seed)
}

func accountIDFromAccount(account AccountInfo) (string, error) {
	return accountIDFromSeed(account.Seed)
}

func encodePayloadStateMap(state State) map[string]any {
	out := cloneExtraFields(state.Extra, 4)
	out["version"] = state.SchemaVersion
	out["accounts"] = state.Accounts
	if state.NotificationServerURL != "" {
		out["notificationServerUrl"] = state.NotificationServerURL
	}
	if len(state.DeletedAccounts) > 0 {
		out["deletedAccounts"] = state.DeletedAccounts
	}
	return out
}

func encodePayloadAccountMap(account AccountInfo) map[string]any {
	out := cloneExtraFields(account.Extra, 4)
	out["seed"] = account.Seed
	out["createTime"] = account.CreateTime
	out["delegations"] = account.Delegations
	if account.Name != "" {
		out["name"] = account.Name
	}
	return out
}

func encodePayloadDelegationMap(delegation DelegationInfo) map[string]any {
	out := cloneExtraFields(delegation.Extra, 4)
	out["clientId"] = delegation.ClientID
	out["capability"] = delegation.Capability
	out["createTime"] = delegation.CreateTime
	if delegation.DeviceType != "" {
		out["deviceType"] = delegation.DeviceType
	}
	return out
}

func encodePayloadDelegationCapabilityMap(capability CapabilityInfo) map[string]any {
	out := cloneExtraFields(capability.Extra, 3)
	out["cid"] = capability.CID
	out["delegate"] = capability.Delegate
	return out
}

func cloneExtraFields(extra map[string]any, knownFieldCount int) map[string]any {
	out := make(map[string]any, len(extra)+knownFieldCount)
	for key, value := range extra {
		out[key] = value
	}
	return out
}

func mapstructDecode(from any, to any) error {
	decoder, err := mapstructure.NewDecoder(&mapstructure.DecoderConfig{
		Result:    to,
		MatchName: func(a, b string) bool { return a == b },
		DecodeHook: func(_ reflect.Type, to reflect.Type, data any) (any, error) {
			if to == reflect.TypeOf(cid.Cid{}) {
				switch v := data.(type) {
				case cid.Cid:
					return v, nil
				case []byte:
					var decoded cid.Cid
					if err := cbornode.DecodeInto(v, &decoded); err == nil {
						return decoded, nil
					}
				}
			}
			return data, nil
		},
	})
	if err != nil {
		return err
	}

	return decoder.Decode(from)
}

func exportedSeed(keyPair *core.KeyPair) ([]byte, error) {
	lkp := keyPair.Libp2pKey()
	if lkp.Type() != crypto.Ed25519 {
		return nil, fmt.Errorf("local vault unsupported key type: %s", lkp.Type())
	}

	rawKey, err := lkp.Raw()
	if err != nil {
		return nil, err
	}
	if len(rawKey) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid ed25519 private key length: expected %d bytes, got %d", ed25519.PrivateKeySize, len(rawKey))
	}

	return ed25519.PrivateKey(rawKey).Seed(), nil
}
