package keystore

import (
	"context"
	"fmt"
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
	if key, exists := findKeyByPrincipal(mks.keys, name); exists {
		return key, nil
	}
	return kp, errKeyNotFound
}

func (mks *memoryStore) StoreKey(_ context.Context, name string, kp *core.KeyPair) error {
	if kp == nil {
		return fmt.Errorf("can't store empty key")
	}
	if err := validateKeyName(name, kp); err != nil {
		return err
	}
	if _, exists := mks.keys[name]; exists {
		return fmt.Errorf("name already exists, delete it first")
	}
	mks.keys[name] = kp
	return nil
}

func (mks *memoryStore) ListKeys(_ context.Context) ([]core.NamedKey, error) {
	out := make([]core.NamedKey, 0, len(mks.keys))
	for name, key := range mks.keys {
		out = append(out, core.NamedKey{Name: name, PublicKey: key.Principal()})
	}
	return out, nil
}

func (mks *memoryStore) ListKeyPairs(_ context.Context) ([]core.NamedKeyPair, error) {
	out := make([]core.NamedKeyPair, 0, len(mks.keys))
	for name, key := range mks.keys {
		out = append(out, core.NamedKeyPair{Name: name, KeyPair: key})
	}
	return out, nil
}

func (mks *memoryStore) DeleteKey(_ context.Context, name string) error {
	if _, exists := mks.keys[name]; exists {
		delete(mks.keys, name)
		return nil
	}
	existingName, _, exists := findKeyNameByPrincipal(mks.keys, name)
	if !exists {
		return errKeyNotFound
	}
	delete(mks.keys, existingName)
	return nil
}

func (mks *memoryStore) DeleteAllKeys(_ context.Context) error {
	mks.keys = map[string]*core.KeyPair{}
	return nil
}

func (mks *memoryStore) ChangeKeyName(_ context.Context, currentName, newName string) error {
	if !nameFormat.MatchString(newName) {
		return fmt.Errorf("invalid new name format")
	}

	name, key, exists := findKeyByNameOrPrincipal(mks.keys, currentName)
	if !exists {
		return errKeyNotFound
	}
	if name == newName {
		return fmt.Errorf("new name equals current name")
	}
	if _, exists := mks.keys[newName]; exists {
		return fmt.Errorf("name already exists, delete it first")
	}
	if err := validateKeyName(newName, key); err != nil {
		return err
	}
	mks.keys[newName] = key
	delete(mks.keys, name)
	return nil
}
