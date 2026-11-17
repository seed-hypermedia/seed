---
name: Keys
summary: How to make a key, find the one the Seed app already has, move a key as a .hmkey.json file, sign on a headless machine, and give a bot a key of its own.
---
A Hypermedia [account](../protocol/identity.md) is an Ed25519 key pair. There is no registration server. Whoever holds the private key is the account, and the public key, written as a `z6Mk…` string, is its name on the network. This page covers the practical side: making a key, finding the one the [Seed app](../software/desktop.md) already has, moving a key between machines, and giving a script or a server a key of its own. [Identity](../protocol/identity.md) explains what a key means in the protocol: how a mnemonic becomes a key, what a [principal](../principal.md) is, every place a private key can live, and why there is no recovery or rotation beyond the mnemonic. <!-- id:ibzVI8ed -->

# Make a key

`seed-cli key generate` makes a new account from a fresh mnemonic and stores it in the OS keyring. It writes 12 words by default and 24 with `--words 24`. `key import "<words>"` stores an existing phrase, and it accepts any valid BIP-39 length: 12, 15, 18, 21 or 24 words. The mnemonic is the only backup of the key, so `--show-mnemonic` prints it once for you to keep.

```sh <!-- id:Zry6pWcC -->
seed-cli key generate -n main --show-mnemonic   # a new account in the OS keyring
seed-cli key derive "word1 word2 … word12"      # prints the account id, stores nothing
```

A known pair, used by the repository's tests, checks an implementation of the derivation: the twelve words `parrot midnight lion defense ski senior trouble slice chase spot history awkward` with no passphrase give the account `z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8`. <!-- id:ncwZbuF5 -->

The Seed app creates the account key from a mnemonic on first run and keeps it in its vault. The [SDK](./sdk.md) does not derive keys from words. It generates a key with `blobs.generateNobleKeyPair()` or rebuilds one from a 32-byte seed. <!-- id:ODrZb7hk -->

# Find a stored key <!-- id:SBHnrprQ -->

```sh <!-- id:1C4OLH6T -->
seed-cli key list           # every key, with its source: vault or keyring
seed-cli --dev key list     # the development keyring and the Seed-dev vault
```

The CLI reads two stores. [Identity](../protocol/identity.md) lists the others.

**The local vault** is an encrypted `vault.json` that the Seed app and the [daemon](../software/daemon.md) write. The state is XChaCha20-Poly1305 encrypted under a data key, and that key is wrapped by a 32-byte secret held in the OS keychain (service `seed-hypermedia-vault-secret-v2`, account `local`). The desktop app's vault is at `~/Library/Application Support/Seed/daemon/vault.json` on macOS and `~/.config/Seed/daemon/vault.json` on Linux (`Seed-dev` for a development build). A bare daemon keeps it under its data directory, `~/.mtt/vault.json` by default. The CLI finds it in this order: `--vault <path>`, `vaultPath` in `~/.seed/config.json`, `SEED_VAULT_PATH`, then those well-known places. The CLI never writes a vault. This local file is not the hosted [vault](../software/vault.md) service, which keeps keys for the web app. <!-- id:_-W97BdO -->

**The keyring** is where `seed-cli key generate` and `key import` write. It holds one record per service (`seed-daemon-main` or `seed-daemon-dev`) under the account name `parentCollection`: a JSON map from key name to base64 of the 68-byte libp2p Ed25519 protobuf (a 4-byte header, the 32-byte seed, the 32-byte public key). The daemon stores that record as `go-keyring-base64:<base64 of the JSON>`. The CLI reads both that form and plain JSON, and writes the daemon's form. macOS uses `security` and Linux uses `secret-tool`. The CLI's keyring code does not support Windows, so on Windows use a key file as described below. <!-- id:UH63EivA -->

When a key exists in both, the vault wins, because a migrated daemon archives its keyring record and the keyring copy is stale by definition. <!-- id:xkt3UdnI -->

A stored key has a name and an account id, and they are different things. Names are local labels (`main`, `imported`, `hm-sync-hypermedia-a1b2c3d4`). The account id is derived from the key and is the same everywhere. A daemon that registers a key without a name uses the account id as the name, which is why `key list` sometimes shows both columns equal. Every CLI command that takes `-k` accepts either. Never treat a name as an identity, because the same name on two machines can be two different keys. <!-- id:IJCSwM4b -->

The key commands are `key generate`, `import`, `list`, `show`, `default`, `rename`, `remove`, `derive` and `export`. [Seed CLI](./cli.md) lists their flags. <!-- id:Yv8bNADI -->

# Move a key: the .hmkey.json file <!-- id:YUkD6tE4 -->

The app, the vault and the CLI all read and write one export format. `seed-cli key export [nameOrId]` writes `<accountId>.hmkey.json` with mode 0600. The app's key export in Settings produces the same file. <!-- id:sWN_YF8h -->

```json <!-- id:d2a3FEu8 -->
{
  "createTime": "2026-09-16T10:00:00.000Z",
  "publicKey": "z6Mk…",
  "keyB64": "<base64 of the 32-byte seed>",
  "profile": {"name": "…"}
}
```

With `--password` the seed is encrypted: `keyB64` holds the ciphertext and an `encryption` object records `kdf: argon2id` with its parameters and `cipher: xchacha20poly1305`. In the SDK, `keyfile.load(json, password?)` returns the seed and `keyfile.create({publicKey, key, password?, profile?})` builds a payload. An unencrypted file is the account. Keep it where you would keep a private key. <!-- id:Va9wkuoB -->

# Sign on a headless machine <!-- id:RuLAAJzM -->

A server, a CI job or a bot has no keychain and no app. Two variables give the CLI a key. Whichever is set overrides every stored key, and `-k` may only name that same account: <!-- id:bM4_vCMu -->

<!-- id:Ge4eUtqj -->
| Variable <!-- col:wKVQ3W14 --> | Holds <!-- col:-4S6j8z6 --> <!-- id:rWCRis6h --> |
| --- | --- |
| `SEED_CLI_KEYFILE` | the whole contents of an unencrypted `.hmkey.json` <!-- id:Q2w6BNQv --> |
| `SEED_CLI_MNEMONIC` | a BIP-39 phrase <!-- id:r2gsjvdS --> |

Set only one of them. The Seed repository [publishes this documentation](../contribute/editing-these-docs.md) this way: the workflow puts a repository secret into `SEED_CLI_KEYFILE` and runs the push script, and the site is that key's own [space](../protocol/spaces.md). Prefer the exported file over a mnemonic. A raw seed cannot be turned back into words, so a key that started life in the app can only travel as a file. <!-- id:cpAnGSI9 -->

A headless machine that runs a daemon can also read the daemon's vault. Point the CLI at the file and pass the vault's secret directly. <!-- id:GvSPYnk9 -->

```sh <!-- id:1g2zj9DO -->
SEED_VAULT_PATH=/srv/seed/daemon/vault.json SEED_VAULT_KEK="$(base64 < kek.bin)" seed-cli key list
```

In your own code, load the seed and build a signer with the [SDK](./sdk.md): `keyfile.load` then `nobleKeyPairFromSeed`, or `loadLocalVaultAccounts` from the `vault-local` module. Every SDK builder accepts the resulting signer. <!-- id:1VB3OAvz -->

# A key for a bot <!-- id:pp4K7-sO -->

A script or an agent should not hold a person's account key. Give it a key of its own, then have the account [delegate](../protocol/permissions.md) to it: <!-- id:zhAoL_eY -->
  1. On the bot's machine: `seed-cli key generate -n bot --show-mnemonic` and keep the words. On a machine with no keyring, export a key elsewhere with `seed-cli key export` and put the file's contents in `SEED_CLI_KEYFILE`. <!-- id:R5BIcYGg -->
  2. Note its account id from `seed-cli key show bot`. <!-- id:-XktdlEH -->
  3. From the account that owns the space: `seed-cli capability create --delegate <bot-id> --role WRITER --path /reports`. <!-- id:Pof_FYSP -->
  4. The bot now writes with `seed-cli document create -a <space-uid> -p reports/today -f today.md -k bot`. The CLI finds the capability and attaches it. `document update` and `document delete` look the capability up without the `-a` flag. <!-- id:zqWAR1zi -->

The `WRITER` [role](../protocol/permissions.md) says "may write". The `AGENT` role says "acts on behalf of", and suits a key that should only act as the account. [Capabilities](../protocol/permissions.md) cannot be revoked. Scope them to a path, and replace the bot's key when in doubt. [Permissions](../protocol/permissions.md) explains the roles. <!-- id:wDZSQyGA -->

Attribution follows from the signature. Every change and comment the bot publishes names the bot's key as its signer, and the capability links it to the account. Give the bot a [profile](../protocol/identity.md) (`seed-cli account profile set --name "Reports bot" -k bot`) so readers see who it is. <!-- id:xJOCwRyM -->

The same shape appears elsewhere. A browser app gets a delegated session key through [Sign in with Seed](./sign-in.md). [Seed Agents](../agent.md) keep their signing identities as encrypted secrets on the app environment, created with `CreateSigningIdentity` or imported as a 32-byte seed, and each agent's definition lists which of them it may sign with. [Using Seed from your own agent](./agents.md) builds on this recipe. <!-- id:hZ3ZrE3A -->

# See also <!-- id:Z5lNFKnj -->

- [Identity](../protocol/identity.md), for derivation, every key store, key linking, and recovery and rotation. <!-- id:YDnNfseC -->
- [Principal](../principal.md) <!-- id:b7J_h__z -->
- [Permissions](../protocol/permissions.md) and [Capability](../capability.md) <!-- id:ttAA_xal -->
- [Privacy](../protocol/privacy.md), for the bearer token that reads private content. <!-- id:wY8hzkYw -->
- [Sign in with Seed](./sign-in.md) <!-- id:4oj8Ks-5 -->
- [Using Seed from your own agent](./agents.md)
- [Seed CLI](./cli.md) <!-- id:4M_T7OSx -->
- [SDK](./sdk.md), for the signer contract and the key helpers. <!-- id:AG3rOWai -->
