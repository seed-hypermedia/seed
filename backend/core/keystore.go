package core

import "context"

// KeyStore is an interface for managing signing keys.
type KeyStore interface {
	GetKey(ctx context.Context, name string) (*KeyPair, error)
	StoreKey(ctx context.Context, name string, kp *KeyPair) error
	ListKeys(ctx context.Context) ([]NamedKey, error)
	DeleteKey(ctx context.Context, name string) error
	DeleteAllKeys(ctx context.Context) error
	ChangeKeyName(ctx context.Context, currentName, newName string) error
}

// NamedKey is a record for the stored private key with a name.
type NamedKey struct {
	Name      string
	PublicKey Principal
}
