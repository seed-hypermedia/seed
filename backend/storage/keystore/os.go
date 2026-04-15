package keystore

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"seed/backend/core"
	"strings"

	"github.com/zalando/go-keyring"
)

type osStore struct {
	serviceName string
}

type keyCollection map[string][]byte

const (
	collectionName = "parentCollection"
)

var (
	errEmptyEnvironment = errors.New("no keys in this environment yet")
	errKeyNotFound      = errors.New("named key not found")
	nameFormat          = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

// goKeyringBase64Prefix is the prefix used by the CLI (and some go-keyring backends)
// to indicate that the keyring value is base64-encoded.
const goKeyringBase64Prefix = "go-keyring-base64:"

// NewOS creates a key store backed by the operating system keyring.
func NewOS(environment string) core.KeyStore {
	if environment == "" {
		panic("BUG: must specify the environment for the OS key store")
	}

	// Suffixing the service name with the environment here
	// to avoid mixing up keys from apps running in different environments.

	return &osStore{
		serviceName: "seed-daemon-" + environment,
	}
}

func (ks *osStore) GetKey(_ context.Context, name string) (*core.KeyPair, error) {
	secret, err := keyring.Get(ks.serviceName, collectionName)
	if err != nil {
		return nil, err
	}

	decoded, err := decodeKeyringSecret(secret)
	if err != nil {
		return nil, err
	}

	collection := keyCollection{}
	if err := json.Unmarshal([]byte(decoded), &collection); err != nil {
		return nil, err
	}

	privBytes, ok := collection[name]
	if !ok {
		return nil, fmt.Errorf("%s: %w", name, errKeyNotFound)
	}

	kp := new(core.KeyPair)
	return kp, kp.UnmarshalBinary(privBytes)
}

func (ks *osStore) StoreKey(_ context.Context, name string, kp *core.KeyPair) error {
	if !nameFormat.MatchString(name) {
		return fmt.Errorf("invalid name format")
	}

	if kp == nil {
		return fmt.Errorf("can't store empty key")
	}

	collection := keyCollection{}
	secret, err := keyring.Get(ks.serviceName, collectionName)
	if err == nil {
		decoded, err := decodeKeyringSecret(secret)
		if err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(decoded), &collection); err != nil {
			return err
		}
		if _, ok := collection[name]; ok {
			return fmt.Errorf("name already exists, delete it first")
		}
	}

	keyBytes, err := kp.MarshalBinary()
	if err != nil {
		return err
	}
	collection[name] = keyBytes

	b, err := json.Marshal(collection)
	if err != nil {
		return err
	}

	return keyring.Set(ks.serviceName, collectionName, string(b))
}

func (ks *osStore) ListKeys(_ context.Context) ([]core.NamedKey, error) {
	// The go-keyring library doesn't let you list the keys given a service name,
	// it only lets you get a key by account name.
	// In theory the underlying tools the library uses let you list keys, but it's not exposed,
	// and maybe it's not very portable across different operating systems.
	// Our best bet would probably be storing the entire bundle of keys under a single credential name,
	// as JSON or Protobuf.
	// The problem here though is that there can be some size limit to that. Apparently it's at least 2KB on most systems,
	// so it shouldn't be a practical issue, unless you store dozens and dozens of keys.
	// Another issues is that if your OS keychain is synced across multiple devices (like iCloud Keychain for macOS and iOS),
	// you might end up overwriting the keys if they are not synced up to date.

	secret, err := keyring.Get(ks.serviceName, collectionName)
	if err != nil {
		return nil, nil
	}

	decoded, err := decodeKeyringSecret(secret)
	if err != nil {
		return nil, err
	}

	collection := keyCollection{}
	if err := json.Unmarshal([]byte(decoded), &collection); err != nil {
		return nil, fmt.Errorf("failed to unmarshal keyring record: %w", err)
	}

	var ret []core.NamedKey
	for name, privBytes := range collection {
		priv := new(core.KeyPair)
		if err := priv.UnmarshalBinary(privBytes); err != nil {
			return nil, err
		}

		ret = append(ret, core.NamedKey{
			Name:      name,
			PublicKey: priv.PublicKey.Principal(),
		})
	}
	return ret, nil
}

func (ks *osStore) DeleteAllKeys(_ context.Context) error {
	if err := keyring.Delete(ks.serviceName, collectionName); err != nil {
		return errEmptyEnvironment
	}
	return nil
}

func (ks *osStore) DeleteKey(_ context.Context, name string) error {
	secret, err := keyring.Get(ks.serviceName, collectionName)
	if err != nil {
		return errEmptyEnvironment
	}

	decoded, err := decodeKeyringSecret(secret)
	if err != nil {
		return err
	}

	collection := keyCollection{}
	if err := json.Unmarshal([]byte(decoded), &collection); err != nil {
		return err
	}

	if _, ok := collection[name]; !ok {
		return errKeyNotFound
	}
	delete(collection, name)

	b, err := json.Marshal(collection)
	if err != nil {
		return err
	}
	return keyring.Set(ks.serviceName, collectionName, string(b))
}

func (ks *osStore) ChangeKeyName(_ context.Context, currentName, newName string) error {
	if currentName == newName {
		return fmt.Errorf("new name equals current name")
	}

	if !nameFormat.MatchString(newName) {
		return fmt.Errorf("invalid new name format")
	}

	secret, err := keyring.Get(ks.serviceName, collectionName)
	if err != nil {
		return errEmptyEnvironment
	}

	decoded, err := decodeKeyringSecret(secret)
	if err != nil {
		return err
	}

	collection := keyCollection{}
	if err := json.Unmarshal([]byte(decoded), &collection); err != nil {
		return err
	}

	privBytes, ok := collection[currentName]
	if !ok {
		return errKeyNotFound
	}

	delete(collection, currentName)
	collection[newName] = privBytes

	b, err := json.Marshal(collection)
	if err != nil {
		return err
	}

	return keyring.Set(ks.serviceName, collectionName, string(b))
}

// decodeKeyringSecret handles keyring values that may be stored in either
// plain text or with a "go-keyring-base64:" prefix (as written by the Seed CLI).
// It returns the decoded string suitable for JSON unmarshaling.
func decodeKeyringSecret(raw string) (string, error) {
	if !strings.HasPrefix(raw, goKeyringBase64Prefix) {
		return raw, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(raw, goKeyringBase64Prefix))
	if err != nil {
		return "", fmt.Errorf("failed to decode base64 keyring value: %w", err)
	}
	return string(decoded), nil
}
