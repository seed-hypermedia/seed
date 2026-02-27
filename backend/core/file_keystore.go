package core

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

type fileKeyStore struct {
	path string
	mu   sync.RWMutex
}

type fileKeyData struct {
	Keys map[string][]byte `json:"keys"`
}

func NewFileKeyStore(path string) KeyStore {
	return &fileKeyStore{path: path}
}

func (fks *fileKeyStore) load() (*fileKeyData, error) {
	data, err := os.ReadFile(fks.path)
	if err != nil {
		if os.IsNotExist(err) {
			return &fileKeyData{Keys: make(map[string][]byte)}, nil
		}
		return nil, err
	}
	var fkd fileKeyData
	if err := json.Unmarshal(data, &fkd); err != nil {
		return nil, err
	}
	if fkd.Keys == nil {
		fkd.Keys = make(map[string][]byte)
	}
	return &fkd, nil
}

func (fks *fileKeyStore) save(fkd *fileKeyData) error {
	data, err := json.MarshalIndent(fkd, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(fks.path, data, 0600)
}

func (fks *fileKeyStore) GetKey(ctx context.Context, name string) (*KeyPair, error) {
	fks.mu.RLock()
	defer fks.mu.RUnlock()

	fkd, err := fks.load()
	if err != nil {
		return nil, err
	}

	privBytes, ok := fkd.Keys[name]
	if !ok {
		return nil, fmt.Errorf("%s: %w", name, errKeyNotFound)
	}

	kp := new(KeyPair)
	return kp, kp.UnmarshalBinary(privBytes)
}

func (fks *fileKeyStore) StoreKey(ctx context.Context, name string, kp *KeyPair) error {
	if !nameFormat.MatchString(name) {
		return fmt.Errorf("invalid name format")
	}
	if kp == nil {
		return fmt.Errorf("can't store empty key")
	}

	fks.mu.Lock()
	defer fks.mu.Unlock()

	fkd, err := fks.load()
	if err != nil {
		return err
	}

	if _, ok := fkd.Keys[name]; ok {
		return fmt.Errorf("Name already exists. Please delete it first")
	}

	keyBytes, err := kp.MarshalBinary()
	if err != nil {
		return err
	}
	fkd.Keys[name] = keyBytes
	return fks.save(fkd)
}

func (fks *fileKeyStore) ListKeys(ctx context.Context) ([]NamedKey, error) {
	fks.mu.RLock()
	defer fks.mu.RUnlock()

	fkd, err := fks.load()
	if err != nil {
		return nil, err
	}

	var ret []NamedKey
	for name, privBytes := range fkd.Keys {
		priv := new(KeyPair)
		if err := priv.UnmarshalBinary(privBytes); err != nil {
			return nil, err
		}
		ret = append(ret, NamedKey{Name: name, PublicKey: priv.Principal()})
	}
	return ret, nil
}

func (fks *fileKeyStore) DeleteKey(ctx context.Context, name string) error {
	fks.mu.Lock()
	defer fks.mu.Unlock()

	fkd, err := fks.load()
	if err != nil {
		return err
	}

	if _, ok := fkd.Keys[name]; !ok {
		return errKeyNotFound
	}
	delete(fkd.Keys, name)
	return fks.save(fkd)
}

func (fks *fileKeyStore) DeleteAllKeys(ctx context.Context) error {
	fks.mu.Lock()
	defer fks.mu.Unlock()
	return fks.save(&fileKeyData{Keys: make(map[string][]byte)})
}

func (fks *fileKeyStore) ChangeKeyName(ctx context.Context, currentName, newName string) error {
	fks.mu.Lock()
	defer fks.mu.Unlock()

	fkd, err := fks.load()
	if err != nil {
		return err
	}

	privBytes, ok := fkd.Keys[currentName]
	if !ok {
		return errKeyNotFound
	}

	delete(fkd.Keys, currentName)
	fkd.Keys[newName] = privBytes
	return fks.save(fkd)
}
