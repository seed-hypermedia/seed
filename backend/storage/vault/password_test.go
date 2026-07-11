package vault

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"testing"

	"golang.org/x/crypto/argon2"
)

// TestPasswordDerivationMatchesVault locks in cross-platform compatibility with
// the web vault's TypeScript derivation (hash-wasm argon2id + WebCrypto
// HKDF-SHA256). The expected values were produced by the vault's TS code for the
// fixed password/salt below. A password set from the desktop daemon must derive
// the exact same keys so it can unlock the vault on the web.
func TestPasswordDerivationMatchesVault(t *testing.T) {
	salt := make([]byte, passwordSaltSize)
	for i := range salt {
		salt[i] = byte(i)
	}
	masterKey := argon2.IDKey([]byte("correct horse battery staple"), salt, passwordArgon2Time, passwordArgon2Memory, passwordArgon2Threads, passwordArgon2KeyLen)

	encKey, err := hkdfSHA256(masterKey, passwordEncryptionKeyInfo, 32)
	if err != nil {
		t.Fatal(err)
	}
	authKey, err := hkdfSHA256(masterKey, passwordAuthKeyInfo, 32)
	if err != nil {
		t.Fatal(err)
	}

	const wantEnc = "3ff17c9f3fdfdf5c57890a16871df699776a6637b6c4a37d72c13ab9d667c82f"
	const wantAuth = "18893d6d09226c22647eac66d5b2797fab991354aa596215121c5127af31dc79"
	if got := hex.EncodeToString(encKey); got != wantEnc {
		t.Fatalf("encryption key mismatch with vault TS derivation:\n got %s\nwant %s", got, wantEnc)
	}
	if got := hex.EncodeToString(authKey); got != wantAuth {
		t.Fatalf("auth key mismatch with vault TS derivation:\n got %s\nwant %s", got, wantAuth)
	}
}

// TestBuildPasswordCredentialRoundTrip verifies the wrapped DEK produced for a
// password credential decrypts back to the original DEK using the key derived
// from the returned salt — i.e. exactly what the web vault does on unlock.
func TestBuildPasswordCredentialRoundTrip(t *testing.T) {
	dek := make([]byte, 64)
	for i := range dek {
		dek[i] = byte(i * 3)
	}

	authB64, saltB64, wrappedB64, err := buildPasswordCredential("hunter2hunter2!", dek)
	if err != nil {
		t.Fatal(err)
	}
	if authB64 == "" {
		t.Fatal("expected an auth key")
	}

	salt, err := base64.RawURLEncoding.DecodeString(saltB64)
	if err != nil {
		t.Fatal(err)
	}
	wrapped, err := base64.RawURLEncoding.DecodeString(wrappedB64)
	if err != nil {
		t.Fatal(err)
	}

	masterKey := argon2.IDKey([]byte("hunter2hunter2!"), salt, passwordArgon2Time, passwordArgon2Memory, passwordArgon2Threads, passwordArgon2KeyLen)
	encKey, err := hkdfSHA256(masterKey, passwordEncryptionKeyInfo, 32)
	if err != nil {
		t.Fatal(err)
	}

	got, err := decryptXChaCha20Payload(wrapped, encKey, "wrapped DEK")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, dek) {
		t.Fatalf("unwrapped DEK does not match original")
	}
}
