---
name: Keys
summary: How a Seed account key is made from a mnemonic, where the app, the daemon and the CLI keep keys, how a key travels as a .hmkey.json file, and how a headless machine signs.
---
A Hypermedia account is an Ed25519 key pair. There is no registration server: whoever holds the private key is the account, and the public key, written as a `z6Mk…` string, is its name on the network. This page is about the practical side: making a key, finding the one the Seed app already has, moving a key between machines, and giving a script or a server a key of its own. [Identity](../protocol/identity.md) explains what a key means in the protocol. <!-- id:ibzVI8ed -->

# From words to a key <!-- id:vEX5yG3F -->

Keys are derived from a [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) mnemonic of 12 or 24 words, with an optional passphrase, through [SLIP-10](https://github.com/satoshilabs/slips/blob/master/slip-0010.md) at the path `m/44'/104109'/0'` (104109 spells `hm` in Unicode). The same words always give the same key on any device, which is what makes the mnemonic a backup. The daemon, the desktop app and the CLI all implement this derivation; the SDK does not, because a script normally holds the derived seed rather than the words. <!-- id:polgroVv -->

The account id is the 32-byte public key with the multicodec prefix `0xed 0x01` in front, encoded as base58btc. The prefix is why every account id starts with `z6Mk`. <!-- id:xyiOEAEs -->

```sh <!-- id:Zry6pWcC -->
seed-cli key derive "word1 word2 … word12"     # prints the account id, stores nothing
```

# Where keys live <!-- id:SBHnrprQ -->

<!-- id:T2g6R2Uh -->
| Store <!-- col:odOZNE-9 --> | Who writes it <!-- col:HIorq9ZF --> | Who reads it <!-- col:LibqXrI4 --> <!-- id:iF1qTemR --> |
| --- | --- | --- |
| The vault, `vault.json` in the daemon's data directory | the Seed app and the daemon | the app, the daemon, the CLI (read-only), the SDK's `vault-local` module <!-- id:oaiVa_ba --> |
| The OS keyring, service `seed-daemon-main` (or `seed-daemon-dev`) | `seed-cli key generate` and `key import`; older daemons | the CLI; a daemon migrates it into the vault on first start <!-- id:dMGlDr2u --> |
| The browser, IndexedDB on the site's origin | the Seed web app and the hosted vault at hyper.media | that browser only <!-- id:y9KVDFSJ --> |
| Environment variables | you, in CI or on a server | the CLI and the folder-publishing script <!-- id:7ZLcLDKQ --> |

**The vault** is an encrypted JSON envelope: the state is XChaCha20-Poly1305 encrypted under a data key, and that key is wrapped by a 32-byte unlock secret held in the OS keychain (service `seed-hypermedia-vault-secret-v2`, account `local`). The desktop app's vault is at `~/Library/Application Support/Seed/daemon/vault.json` on macOS and `~/.config/Seed/daemon/vault.json` on Linux (`Seed-dev` for a development build); a bare daemon keeps it under its data directory, `~/.mtt/vault.json` by default. The CLI finds it in this order: `--vault <path>`, `vaultPath` in `~/.seed/config.json`, `SEED_VAULT_PATH`, then those well-known places. The CLI never writes a vault. <!-- id:_-W97BdO -->

**The keyring** holds one JSON record per service, mapping key names to base64 of the 68-byte libp2p Ed25519 protobuf (a 4-byte header, the 32-byte seed, the 32-byte public key). macOS uses `security`, Linux `secret-tool`; Windows is not supported by the CLI's keyring code. <!-- id:UH63EivA -->

When a key exists in both, the vault wins, because a migrated daemon archives its keyring record and the keyring copy is stale by definition. <!-- id:xkt3UdnI -->

```sh <!-- id:1C4OLH6T -->
seed-cli key list           # every key, with its source: vault or keyring
seed-cli --dev key list     # the development keyring and the Seed-dev vault
```

# Names and principals <!-- id:k4dOwX6q -->

A stored key has a name and an account id, and they are different things. Names are local labels (`main`, `imported`, `hm-sync-hypermedia-a1b2c3d4`); the account id is derived from the key and is the same everywhere. A daemon that registers a key without a name uses the account id as the name, which is why `key list` sometimes shows both columns equal. Every CLI command that takes `-k` accepts either, but never treat a name as an identity: the same name on two machines can be two different keys. <!-- id:IJCSwM4b -->

# Moving a key: the .hmkey.json file <!-- id:YUkD6tE4 -->

The app, the vault and the CLI all read and write one export format. `seed-cli key export [nameOrId]` writes `<accountId>.hmkey.json` with mode 0600; the app's key export produces the same file. <!-- id:sWN_YF8h -->

```json <!-- id:d2a3FEu8 -->
{
  "createTime": "2026-09-16T10:00:00.000Z",
  "publicKey": "z6Mk…",
  "keyB64": "<base64 of the 32-byte seed>",
  "profile": {"name": "…"}
}
```

With `--password` the seed is encrypted instead: `keyB64` holds the ciphertext and an `encryption` object records `kdf: argon2id` with its parameters and `cipher: xchacha20poly1305`. In the SDK, `keyfile.load(json, password?)` returns the seed and `keyfile.create({publicKey, key, password?, profile?})` builds a payload. An unencrypted file is the account; keep it where you would keep a private key. <!-- id:Va9wkuoB -->

# Headless machines <!-- id:RuLAAJzM -->

A server, a CI job or a bot has no keychain and no app. Two variables give the CLI a key; whichever is set overrides every stored key, and `-k` may only name that same account: <!-- id:bM4_vCMu -->

<!-- id:Ge4eUtqj -->
| Variable <!-- col:wKVQ3W14 --> | Holds <!-- col:-4S6j8z6 --> <!-- id:rWCRis6h --> |
| --- | --- |
| `SEED_CLI_KEYFILE` | the whole contents of an unencrypted `.hmkey.json` <!-- id:Q2w6BNQv --> |
| `SEED_CLI_MNEMONIC` | a BIP-39 phrase <!-- id:r2gsjvdS --> |

Set one, not both. This is how the repository publishes this documentation: the workflow puts a repository secret into `SEED_CLI_KEYFILE` and runs the push script, and the site is that key's own space. The exported file is preferred over a mnemonic because a raw seed cannot be turned back into words, so a key that started life in the app can only travel as a file. <!-- id:cpAnGSI9 -->

A headless machine that runs a daemon can also read the daemon's vault: point the CLI at the file and pass the unlock secret directly. <!-- id:GvSPYnk9 -->

```sh <!-- id:1g2zj9DO -->
SEED_VAULT_PATH=/srv/seed/daemon/vault.json SEED_VAULT_KEK="$(base64 < kek.bin)" seed-cli key list
```

In your own code, load the seed and build a signer with the [SDK](./sdk.md): `keyfile.load` then `nobleKeyPairFromSeed`, or `loadLocalVaultAccounts` from the `vault-local` module. <!-- id:1VB3OAvz -->

# A key for a bot <!-- id:pp4K7-sO -->

A script should not hold a person's account key. Give it a key of its own, then have the account delegate to it: <!-- id:zhAoL_eY -->
  1. On the bot's machine: `seed-cli key generate -n bot --show-mnemonic` and keep the words. <!-- id:R5BIcYGg -->
  2. Note its account id from `seed-cli key show bot`. <!-- id:-XktdlEH -->
  3. From the account that owns the space: `seed-cli capability create --delegate <bot-id> --role WRITER --path /reports`. <!-- id:Pof_FYSP -->
  4. The bot now writes with `seed-cli document create -a <space-uid> -p reports/today -f today.md -k bot`; the CLI finds the capability and attaches it. <!-- id:zqWAR1zi -->

Capabilities cannot be revoked today, so scope them to a path and prefer the `AGENT` role for a key that should only act on the account's behalf; [Permissions](../protocol/permissions.md) explains the roles. A browser app gets a delegated session key the same way through [Sign in with Seed](./sign-in.md), and Seed Agents hold their identities as server-side secrets created with `CreateSigningIdentity` or imported as a 32-byte seed. <!-- id:wDZSQyGA -->

# Recovery and rotation <!-- id:95hnBphk -->

There is no account recovery beyond the mnemonic: re-import the words on a new machine and the same account exists there. Rotation does not exist either; what exists is linking a second key to the account with an `AGENT` capability and a profile alias, so that a new device or a new key acts as the same person. See [Identity](../protocol/identity.md). <!-- id:K0OVIun5 -->

# Working with it <!-- id:pF4SL-vW -->

## In the Seed app <!-- id:bJSHV5vf -->

The app creates the account key from a mnemonic on first run and keeps it in the vault; Settings offers the key export that produces the `.hmkey.json` above. <!-- id:ODrZb7hk -->

## CLI <!-- id:omfBlvx9 -->

`key generate`, `import`, `list`, `show`, `default`, `rename`, `remove`, `derive`, `export`; `-k` on every writing command; `--vault`, `--dev`; the environment variables in the table above. [Seed CLI](./cli.md) lists them all. <!-- id:Yv8bNADI -->

## SDK <!-- id:y9sCl9J4 -->

`keyfile`, `vault-local`, `blobs.nobleKeyPairFromSeed`, `blobs.generateNobleKeyPair`, `principalToString`; the `HMSigner` contract that every builder accepts. <!-- id:AG3rOWai -->

## Web API <!-- id:GYhe1Ljn -->

The API itself has no key operations. A daemon bearer token, obtained by signing an authentication request, is what unlocks private reads over the API; the site's `/hm/api/auth` route turns it into a cookie. See [Seed API](./web-api.md). <!-- id:wY8hzkYw -->

## Agents <!-- id:6jkHLbzL -->

Seed Agents keep signing identities as encrypted per-account secrets on the agents server, one or more per account, and an agent's definition lists which of them it may sign with. An external agent should use a bot key delegated as above, held in `SEED_CLI_KEYFILE` for the CLI or loaded through `keyfile` for the SDK. See [Using Seed from your own agent](./agents.md). <!-- id:hZ3ZrE3A -->

# See also <!-- id:Z5lNFKnj -->

- [Identity](../protocol/identity.md), [Permissions](../protocol/permissions.md), [Integrity](../protocol/integrity.md) <!-- id:YDnNfseC -->
- [Principal](../principal.md), [Capability](../capability.md) <!-- id:b7J_h__z -->
