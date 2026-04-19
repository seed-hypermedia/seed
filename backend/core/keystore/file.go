package keystore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"seed/backend/core"
)

// NewFile creates a key store backed by files in a directory.
// Keys are stored as plaintext JSON and should only be used for testing.
func NewFile(dir string) (core.KeyStore, error) {
	if dir == "" {
		return nil, errors.New("must specify directory for file key store")
	}

	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create keystore dir: %w", err)
	}

	return &fileStore{dir: dir}, nil
}

type fileStore struct {
	dir string
}

func (fks *fileStore) keysFilePath() string {
	return filepath.Join(fks.dir, "account_keys.json")
}

func (fks *fileStore) readCollection() (keyCollection, error) {
	data, err := os.ReadFile(fks.keysFilePath())
	if err != nil {
		if os.IsNotExist(err) {
			return keyCollection{}, nil
		}
		return nil, err
	}

	collection := keyCollection{}
	if err := json.Unmarshal(data, &collection); err != nil {
		return nil, fmt.Errorf("failed to unmarshal keys file: %w", err)
	}

	return collection, nil
}

func (fks *fileStore) writeCollection(collection keyCollection) error {
	data, err := json.MarshalIndent(collection, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(fks.keysFilePath(), data, 0600)
}

func (fks *fileStore) GetKey(_ context.Context, name string) (*core.KeyPair, error) {
	collection, err := fks.readCollection()
	if err != nil {
		return nil, err
	}

	privBytes, ok := collection[name]
	if !ok {
		return nil, fmt.Errorf("%s: %w", name, errKeyNotFound)
	}

	kp := new(core.KeyPair)
	return kp, kp.UnmarshalBinary(privBytes)
}

func (fks *fileStore) StoreKey(_ context.Context, name string, kp *core.KeyPair) error {
	if !nameFormat.MatchString(name) {
		return fmt.Errorf("invalid name format")
	}
	if kp == nil {
		return fmt.Errorf("can't store empty key")
	}

	collection, err := fks.readCollection()
	if err != nil {
		return err
	}

	if _, ok := collection[name]; ok {
		return fmt.Errorf("name already exists, delete it first")
	}

	keyBytes, err := kp.MarshalBinary()
	if err != nil {
		return err
	}

	collection[name] = keyBytes
	return fks.writeCollection(collection)
}

func (fks *fileStore) ListKeys(_ context.Context) ([]core.NamedKey, error) {
	collection, err := fks.readCollection()
	if err != nil {
		return nil, err
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

func (fks *fileStore) DeleteAllKeys(_ context.Context) error {
	if err := os.Remove(fks.keysFilePath()); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return nil
}

func (fks *fileStore) DeleteKey(_ context.Context, name string) error {
	collection, err := fks.readCollection()
	if err != nil {
		return err
	}

	if _, ok := collection[name]; !ok {
		return errKeyNotFound
	}

	delete(collection, name)
	return fks.writeCollection(collection)
}

func (fks *fileStore) ChangeKeyName(_ context.Context, currentName, newName string) error {
	if currentName == newName {
		return fmt.Errorf("new name equals current name")
	}

	if !nameFormat.MatchString(newName) {
		return fmt.Errorf("invalid new name format")
	}

	collection, err := fks.readCollection()
	if err != nil {
		return err
	}

	privBytes, ok := collection[currentName]
	if !ok {
		return errKeyNotFound
	}

	delete(collection, currentName)
	collection[newName] = privBytes
	return fks.writeCollection(collection)
}
