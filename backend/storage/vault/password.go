package vault

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/hkdf"
)

// Master-password key derivation. These must stay byte-for-byte compatible with
// the web vault's TypeScript implementation (frontend/packages/client encryption
// + vault/src/frontend/crypto), so a password set from desktop can unlock the
// vault on the web and vice versa:
//   - Argon2id(password, salt) -> 32-byte master key
//   - HKDF-SHA256(masterKey, info) -> 32-byte encryption key / auth key
//   - XChaCha20-Poly1305(DEK, encryptionKey) -> wrapped DEK
const (
	passwordArgon2Time    = 3
	passwordArgon2Memory  = 64 * 1024 // 64 MiB, in KiB (matches memoryCost: 65536)
	passwordArgon2Threads = 4
	passwordArgon2KeyLen  = 32
	passwordSaltSize      = 16

	// HKDF info labels for domain separation, not credentials.
	passwordEncryptionKeyInfo = "seed-hypermedia-vault-encryption"     //nolint:gosec // G101: HKDF info label, not a secret
	passwordAuthKeyInfo       = "seed-hypermedia-vault-authentication" //nolint:gosec // G101: HKDF info label, not a secret
)

// hkdfSHA256 derives n bytes from key using HKDF-SHA256 with an empty (zero)
// salt and the given info string, matching the vault's WebCrypto HKDF usage.
func hkdfSHA256(key []byte, info string, n int) ([]byte, error) {
	out := make([]byte, n)
	reader := hkdf.New(sha256.New, key, nil, []byte(info))
	if _, err := io.ReadFull(reader, out); err != nil {
		return nil, fmt.Errorf("failed deriving HKDF key: %w", err)
	}
	return out, nil
}

// buildPasswordCredential derives the (authKey, salt, wrappedDEK) a vault
// password credential needs from a plaintext password and the plaintext DEK. All
// three are returned base64url-encoded (matching the vault server's expectations).
func buildPasswordCredential(password string, dek []byte) (authKeyB64 string, saltB64 string, wrappedDEKB64 string, err error) {
	salt := make([]byte, passwordSaltSize)
	if _, err := rand.Read(salt); err != nil {
		return "", "", "", fmt.Errorf("failed to generate password salt: %w", err)
	}

	masterKey := argon2.IDKey([]byte(password), salt, passwordArgon2Time, passwordArgon2Memory, passwordArgon2Threads, passwordArgon2KeyLen)

	encryptionKey, err := hkdfSHA256(masterKey, passwordEncryptionKeyInfo, 32)
	if err != nil {
		return "", "", "", err
	}
	authKey, err := hkdfSHA256(masterKey, passwordAuthKeyInfo, 32)
	if err != nil {
		return "", "", "", err
	}

	wrappedDEK, err := encryptXChaCha20Payload(dek, encryptionKey, "wrapped DEK")
	if err != nil {
		return "", "", "", err
	}

	enc := base64.RawURLEncoding
	return enc.EncodeToString(authKey), enc.EncodeToString(salt), enc.EncodeToString(wrappedDEK), nil
}

// VaultPasswordIsSet reports whether the connected remote vault user already has
// a master-password credential.
func (ks *Vault) VaultPasswordIsSet(ctx context.Context) (bool, error) {
	remoteURL, bearerAuth, err := ks.activeRemoteEmailAuth()
	if err != nil {
		return false, err
	}
	snapshot, err := ks.getRemote(ctx, remoteURL, bearerAuth, 0)
	if err != nil {
		return false, err
	}
	for _, credential := range snapshot.Credentials {
		if credential.Kind == "password" {
			return true, nil
		}
	}
	return false, nil
}

// SetVaultMasterPassword sets or changes the connected remote vault user's master
// password. The daemon unwraps the in-daemon DEK, derives the password credential
// locally, and uploads only the derived material — the plaintext password never
// leaves the daemon.
func (ks *Vault) SetVaultMasterPassword(ctx context.Context, password string) error {
	if password == "" {
		return fmt.Errorf("password is required")
	}

	localRemote, localCredential, remoteSecret, enabled, err := ks.loadRemoteSyncState()
	if err != nil {
		return err
	}
	if !enabled {
		return fmt.Errorf("not connected to a remote vault")
	}

	bearerAuth, err := buildRemoteBearerAuth(localRemote.CredentialID, remoteSecret)
	if err != nil {
		return fmt.Errorf("failed to derive remote vault bearer auth: %w", err)
	}

	dek, err := decodeRemoteDataEncryptionKey(remoteSecret, localCredential.WrappedDEK)
	if err != nil {
		return fmt.Errorf("failed to unwrap vault data key: %w", err)
	}

	authKeyB64, saltB64, wrappedDEKB64, err := buildPasswordCredential(password, dek)
	if err != nil {
		return err
	}

	// Decide add vs change based on whether a password credential already exists.
	snapshot, err := ks.getRemote(ctx, localRemote.VaultURL, bearerAuth, 0)
	if err != nil {
		return err
	}
	hasPassword := false
	for _, credential := range snapshot.Credentials {
		if credential.Kind == "password" {
			hasPassword = true
			break
		}
	}

	endpointPath := "api/credentials/password"
	if hasPassword {
		endpointPath = "api/credentials/password/change"
	}

	reqBody := map[string]string{
		"authKey":    authKeyB64,
		"salt":       saltB64,
		"wrappedDEK": wrappedDEKB64,
	}
	return ks.requestRemoteEmail(ctx, http.MethodPost, endpointPath, localRemote.VaultURL, bearerAuth, reqBody, nil)
}
