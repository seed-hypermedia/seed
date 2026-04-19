package vault

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"seed/backend/core"
	"seed/backend/core/keystore"
)

// NewProduction creates the daemon production vault.
// It uses the local vault file for storing signing keys.
// The vault is encrypted with a symmetric key, stored in the OS keychain.
// This function also does the migration (if needed) from the legacy setup,
// where we were storing the signing keys themselves in the OS keychain.
func NewProduction(dataDir, environment string, opts ...RemoteOption) (*Vault, error) {
	secretStore, err := NewOSKeychainSecretStore()
	if err != nil {
		return nil, fmt.Errorf("failed to load vault key: %w", err)
	}

	return openProduction(dataDir, keystore.NewOS(environment), secretStore, opts...)
}

func openProduction(dataDir string, legacy core.KeyStore, secretStore SecretStore, opts ...RemoteOption) (*Vault, error) {
	needsLegacyMigration, err := productionVaultNeedsLegacyMigration(dataDir)
	if err != nil {
		return nil, err
	}

	local, err := New(dataDir, secretStore, opts...)
	if err != nil {
		return nil, err
	}

	if legacy == nil || !needsLegacyMigration {
		return local, nil
	}

	if err := local.migrateLegacyKeys(context.Background(), legacy); err != nil {
		return nil, err
	}

	return local, nil
}

func productionVaultNeedsLegacyMigration(dataDir string) (bool, error) {
	_, err := os.Stat(filepath.Join(dataDir, fileName))
	if err == nil {
		return false, nil
	}
	if os.IsNotExist(err) {
		return true, nil
	}

	return false, fmt.Errorf("failed checking local vault file: %w", err)
}

func (v *Vault) migrateLegacyKeys(ctx context.Context, legacy core.KeyStore) error {
	legacyKeys, err := v.legacyKeySnapshot(ctx, legacy)
	if err != nil {
		return fmt.Errorf("failed reading legacy key snapshot: %w", err)
	}
	return v.migrateLegacyKeySnapshot(ctx, legacyKeys)
}

func (v *Vault) migrateLegacyKeySnapshot(ctx context.Context, legacyKeys map[string][]byte) error {
	if len(legacyKeys) == 0 {
		return nil
	}

	localKeys, err := v.keySnapshot(ctx)
	if err != nil {
		return fmt.Errorf("failed reading local vault key snapshot: %w", err)
	}

	missingLegacyKeys, err := v.diffMissingLegacyKeys(localKeys, legacyKeys)
	if err != nil {
		return fmt.Errorf("failed comparing local and legacy key snapshots: %w", err)
	}

	if _, err := v.applyMutation(func(_ *Envelope, state *State) (bool, error) {
		for _, name := range missingLegacyKeys {
			kp := new(core.KeyPair)
			if err := kp.UnmarshalBinary(legacyKeys[name]); err != nil {
				return false, fmt.Errorf("failed decoding legacy key %q: %w", name, err)
			}

			seed, err := exportedSeed(kp)
			if err != nil {
				return false, fmt.Errorf("failed exporting legacy key %q: %w", name, err)
			}

			state.Accounts = append(state.Accounts, payloadAccountFromMetadata(name, seed, KeyMetadata{}))
			if state.Accounts[len(state.Accounts)-1].CreateTime == 0 {
				state.Accounts[len(state.Accounts)-1].CreateTime = time.Now().UTC().UnixMilli()
			}
			delete(state.DeletedAccounts, kp.Principal().String())
		}

		return true, nil
	}); err != nil {
		return fmt.Errorf("failed storing migrated legacy keys in local vault: %w", err)
	}

	localKeys, err = v.keySnapshot(ctx)
	if err != nil {
		return fmt.Errorf("failed reading local vault key snapshot after migration write: %w", err)
	}

	// Verify that we've migrated all the legacy keys to the local vault.
	{
		missing, err := v.diffMissingLegacyKeys(localKeys, legacyKeys)
		if err != nil {
			return err
		}
		if len(missing) > 0 {
			return fmt.Errorf("local vault is missing legacy keys: %v", missing)
		}
	}

	// We are leaving the keychain record behind, just in case of any issues might arise.

	return nil
}

func (v *Vault) keySnapshot(ctx context.Context) (map[string][]byte, error) {
	keys, err := v.ListKeys(ctx)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[string][]byte, len(keys))
	for _, key := range keys {
		if _, exists := snapshot[key.Name]; exists {
			return nil, fmt.Errorf("duplicate key name %q in keystore list", key.Name)
		}

		kp, err := v.GetKey(ctx, key.Name)
		if err != nil {
			return nil, err
		}
		if kp == nil {
			return nil, fmt.Errorf("key %q resolved to nil keypair", key.Name)
		}

		privBytes, err := kp.MarshalBinary()
		if err != nil {
			return nil, err
		}
		snapshot[key.Name] = privBytes
	}

	return snapshot, nil
}

func (v *Vault) legacyKeySnapshot(ctx context.Context, legacy core.KeyStore) (map[string][]byte, error) {
	keys, err := legacy.ListKeys(ctx)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[string][]byte, len(keys))
	for _, key := range keys {
		if _, exists := snapshot[key.Name]; exists {
			return nil, fmt.Errorf("duplicate key name %q in keystore list", key.Name)
		}

		kp, err := legacy.GetKey(ctx, key.Name)
		if err != nil {
			return nil, err
		}
		if kp == nil {
			return nil, fmt.Errorf("key %q resolved to nil keypair", key.Name)
		}

		privBytes, err := kp.MarshalBinary()
		if err != nil {
			return nil, err
		}
		snapshot[key.Name] = privBytes
	}

	return snapshot, nil
}

func (v *Vault) diffMissingLegacyKeys(local, legacy map[string][]byte) ([]string, error) {
	missing := make([]string, 0)
	for name, legacyBytes := range legacy {
		localBytes, ok := local[name]
		if !ok {
			missing = append(missing, name)
			continue
		}
		if !bytes.Equal(localBytes, legacyBytes) {
			return nil, fmt.Errorf("key %q has different private key keys between local vault and legacy key store", name)
		}
	}
	sort.Strings(missing)

	return missing, nil
}
