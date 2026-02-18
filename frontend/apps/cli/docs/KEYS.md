# Seed Hypermedia Key Management Reference

## Overview

The Seed CLI stores Ed25519 signing keys in the **OS keyring**, shared with the
Go daemon. This means keys registered via the desktop app are immediately
available to the CLI and vice-versa. No daemon needs to be running — the CLI
reads and writes the keyring directly.

## Keyring Storage

Keys are stored as a single JSON blob under a service/account pair in the OS
credential store:

| Field   | Value                                                              |
| ------- | ------------------------------------------------------------------ |
| Service | `seed-daemon-main` (production) or `seed-daemon-dev` (development) |
| Account | `parentCollection`                                                 |

The JSON payload is a flat map of **key name -> base64-encoded libp2p protobuf
bytes**:

```json
{
  "main": "CAES...",
  "z6MkuMzdbZ3D7D9xgCi2gV2xosPNzzoy467qZugfH4JdUuhM": "CAES..."
}
```

## Key Names vs Account IDs

Each entry in the keyring has a **name** (the JSON key) and a deterministic
**account ID** derived from the public key. These are often different:

- When a key is created with an explicit name (e.g.,
  `seed-cli key generate --name main`), the name is human-readable.
- When the Go daemon registers a key **without a name**, it falls back to using
  the account ID as the name. This is why `key list` sometimes shows identical
  `name` and `accountId` fields.

The relevant logic in the daemon (`backend/api/daemon/v1alpha/daemon.go`):

```go
if req.Name == "" {
    req.Name = acc.PublicKey.String()
}
```

You can look up a key by either its name or account ID — the CLI tries a direct
name match first, then scans all entries comparing derived account IDs.

## Key Encoding Format

Each key value is a 68-byte blob encoded as base64:

```
[4-byte header] [32-byte private seed] [32-byte public key]
```

The header is the libp2p Ed25519 protobuf envelope:

```
08 01 12 40
│  │  │  └─ varint 64 (field 2 length = 64 bytes: seed + pubkey)
│  │  └──── field 2 tag (key data)
│  └─────── varint 1 (Ed25519 key type)
└────────── field 1 tag (key type)
```

The CLI decodes this by simple byte slicing — no protobuf library needed:

```typescript
const privateKey = raw.subarray(4, 36) // 32-byte Ed25519 seed
const publicKey = raw.subarray(36, 68) // 32-byte Ed25519 public key
```

## Account ID Derivation

The account ID is a base58btc-encoded multicodec-prefixed Ed25519 public key:

```typescript
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

function computeAccountId(publicKey: Uint8Array): string {
  const withPrefix = new Uint8Array(2 + publicKey.length)
  withPrefix.set(ED25519_MULTICODEC_PREFIX, 0)
  withPrefix.set(publicKey, 2)
  return base58btc.encode(withPrefix) // e.g., "z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8"
}
```

All account IDs start with `z6Mk` (the base58btc multibase prefix `z` + the
Ed25519 multicodec bytes).

## Key Derivation from Mnemonic

Keys are derived from BIP-39 mnemonics via SLIP-10 at the path
`m/44'/104109'/0'` (104109 = Unicode `h` + `m`). Same mnemonic + passphrase =
same account on any device.

See `SIGNING.md` for the full derivation code.

## Cross-Platform Keyring Access

| Platform | Backend                          | CLI tool used |
| -------- | -------------------------------- | ------------- |
| Linux    | D-Bus Secret Service (libsecret) | `secret-tool` |
| macOS    | Keychain                         | `security`    |

### Linux

```bash
# Read keys
secret-tool lookup service seed-daemon-main username parentCollection

# Write keys
echo '{"main":"CAES..."}' | secret-tool store \
  --label "Password for 'parentCollection' on 'seed-daemon-main'" \
  service seed-daemon-main username parentCollection
```

### macOS

```bash
# Read keys
security find-generic-password -s seed-daemon-main -a parentCollection -w

# Write keys
security add-generic-password -U -s seed-daemon-main -a parentCollection -w '{"main":"CAES..."}'
```

## The `--dev` Flag

The global `--dev` flag switches the keyring service name from
`seed-daemon-main` to `seed-daemon-dev`. This keeps development keys separate
from production keys:

```bash
# List production keys
seed-cli key list

# List development keys
seed-cli --dev key list
```

The desktop app uses `seed-daemon-dev` when running in development mode
(`./dev run-desktop`), so `--dev` gives CLI access to those same keys.

## CLI Key Commands

```bash
# List all keys in the keyring
seed-cli key list

# Show a specific key by name or account ID
seed-cli key show main
seed-cli key show z6Mk...

# Generate a new key (stores in keyring)
seed-cli key generate --name mykey --show-mnemonic

# Import from existing mnemonic
seed-cli key import --name imported "word1 word2 ... word12"

# Derive account ID without storing
seed-cli key derive "word1 word2 ... word12"

# Remove a key
seed-cli key remove mykey --force

# Set default signing key
seed-cli key default mykey
```

## Implementation Files

| File                          | Purpose                              |
| ----------------------------- | ------------------------------------ |
| `src/utils/keyring.ts`        | Cross-platform OS keyring read/write |
| `src/utils/key-derivation.ts` | BIP-39 / SLIP-10 key derivation      |
| `src/commands/key.ts`         | CLI key subcommands                  |
| `src/config.ts`               | Default key config persistence       |
