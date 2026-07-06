package keystore

import (
	"fmt"

	"seed/backend/core"
)

func validateKeyName(name string, kp *core.KeyPair) error {
	if !nameFormat.MatchString(name) {
		return fmt.Errorf("invalid name format")
	}
	if principal, err := core.DecodePrincipal(name); err == nil && !principal.Equal(kp.Principal()) {
		return fmt.Errorf("key name parses as a different public key")
	}
	return nil
}

func findKeyByNameOrPrincipal(keys map[string]*core.KeyPair, name string) (string, *core.KeyPair, bool) {
	if key, exists := keys[name]; exists {
		return name, key, true
	}
	return findKeyNameByPrincipal(keys, name)
}

func findKeyByPrincipal(keys map[string]*core.KeyPair, name string) (*core.KeyPair, bool) {
	_, key, exists := findKeyNameByPrincipal(keys, name)
	return key, exists
}

func findKeyNameByPrincipal(keys map[string]*core.KeyPair, name string) (string, *core.KeyPair, bool) {
	principal, err := core.DecodePrincipal(name)
	if err != nil {
		return "", nil, false
	}

	for keyName, key := range keys {
		if key.Principal().Equal(principal) {
			return keyName, key, true
		}
	}
	return "", nil, false
}

func findKeyBytesByNameOrPrincipal(keys keyCollection, name string) (string, []byte, bool, error) {
	if keyBytes, exists := keys[name]; exists {
		return name, keyBytes, true, nil
	}
	return findKeyBytesByPrincipal(keys, name)
}

func findKeyBytesByPrincipal(keys keyCollection, name string) (string, []byte, bool, error) {
	principal, err := core.DecodePrincipal(name)
	if err != nil {
		return "", nil, false, nil
	}

	for keyName, keyBytes := range keys {
		kp := new(core.KeyPair)
		if err := kp.UnmarshalBinary(keyBytes); err != nil {
			return "", nil, false, err
		}
		if kp.Principal().Equal(principal) {
			return keyName, keyBytes, true, nil
		}
	}
	return "", nil, false, nil
}
