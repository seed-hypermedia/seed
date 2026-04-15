package keystore

import (
	"context"
	"seed/backend/core"
)

// NewMemory creates an in-memory key store implementation.
func NewMemory() core.KeyStore {
	return &memoryStore{
		keys: make(map[string]*core.KeyPair),
	}
}

type memoryStore struct {
	keys map[string]*core.KeyPair
}

func (mks *memoryStore) GetKey(_ context.Context, name string) (kp *core.KeyPair, err error) {
	if key, exists := mks.keys[name]; exists {
		return key, nil
	}
	return kp, errKeyNotFound
}

func (mks *memoryStore) StoreKey(_ context.Context, name string, kp *core.KeyPair) error {
	mks.keys[name] = kp
	return nil
}

func (mks *memoryStore) ListKeys(_ context.Context) ([]core.NamedKey, error) {
	var namedKeys []core.NamedKey
	for name, key := range mks.keys {
		namedKeys = append(namedKeys, core.NamedKey{Name: name, PublicKey: key.Principal()})
	}
	return namedKeys, nil
}

func (mks *memoryStore) DeleteKey(_ context.Context, name string) error {
	delete(mks.keys, name)
	return nil
}

func (mks *memoryStore) DeleteAllKeys(_ context.Context) error {
	mks.keys = map[string]*core.KeyPair{}
	return nil
}

func (mks *memoryStore) ChangeKeyName(_ context.Context, currentName, newName string) error {
	if key, exists := mks.keys[currentName]; exists {
		mks.keys[newName] = key
		delete(mks.keys, currentName)
	}
	return nil
}
