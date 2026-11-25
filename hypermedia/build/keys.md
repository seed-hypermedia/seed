---
name: Keys
summary: This guide shows how to make a key, find the one the Seed app already has, move a key as a .hmkey.json file, sign on a machine with no screen, and give a bot a key of its own.
---
A Hypermedia [account](../protocol/identity.md) is a pair of keys: a private key and a public key. Nobody registers an account on a server. Whoever holds the private key is the account. The public key, written as a string that starts with `z6Mk`, is the account's name on the network. <!-- id:ibzVI8ed -->

This page is the practical side. It shows how to:

- make a key;
- find the key the [Seed app](../software/desktop.md) already has;
- move a key from one machine to another;
- give a script or a server a key of its own.

[Identity](../protocol/identity.md) explains what a key means in the protocol: how a mnemonic (a list of words) becomes a key, what a [principal](../principal.md) is, every place a private key can live, and why the mnemonic is the only way to recover a key.

# Make a key

1. Run `seed-cli key generate`. It makes a new account from a new mnemonic and stores it in the keyring of your operating system.
2. Add `--show-mnemonic` to print the words once. The mnemonic is the only backup of the key, so keep it.
3. To check an account id without storing anything, run `seed-cli key derive "<words>"`.

```sh <!-- id:Zry6pWcC -->
seed-cli key generate -n main --show-mnemonic   # a new account in the OS keyring
seed-cli key derive "word1 word2 … word12"      # prints the account id, stores nothing
```

`key generate` writes 12 words, or 24 with `--words 24`. `key import "<words>"` stores a phrase you already have. It accepts any valid BIP-39 length: 12, 15, 18, 21 or 24 words.

To test your own code that turns words into a key, use this known pair from the repository's tests. The twelve words `parrot midnight lion defense ski senior trouble slice chase spot history awkward`, with no passphrase, give the account `z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8`. <!-- id:ncwZbuF5 -->

The Seed app makes the account key from a mnemonic the first time it runs, and keeps it in its vault. The [SDK](./sdk.md) does not turn words into keys. It makes a new key with `blobs.generateNobleKeyPair()`, or rebuilds one from a 32-byte seed. <!-- id:ODrZb7hk -->

# Find a stored key <!-- id:SBHnrprQ -->

```sh <!-- id:1C4OLH6T -->
seed-cli key list           # every key the CLI can see, with its source: vault or keyring
seed-cli --dev key list     # the development keyring and the vault in the Seed-dev folder
```

The CLI reads keys from two stores: the local vault and the keyring. [Identity](../protocol/identity.md) lists the other places a key can live.

## The local vault

The local vault is an encrypted file, `vault.json`. The Seed app and the [daemon](../software/daemon.md) write it. The CLI only reads it and never writes it. <!-- id:_-W97BdO -->

The desktop app keeps the file here:

- macOS: `~/Library/Application Support/Seed/daemon/vault.json`
- Linux: `~/.config/Seed/daemon/vault.json`

A daemon that runs without the app keeps it in its data folder, `~/.mtt/vault.json` by default.

The CLI looks for the file in this order:

1. `--vault <path>`
2. `vaultPath` in `~/.seed/config.json`
3. `SEED_VAULT_PATH`
4. the well-known places listed here

With `--dev` the CLI looks in the folder `Seed-dev` in place of `Seed`. An app started with `./dev` keeps its data in a different folder, `Seed-local`. So to read that app's keys, point the CLI at its vault with `--vault <path>`.

How the file is protected: the content is encrypted with XChaCha20-Poly1305 under a data key. That data key is wrapped by a 32-byte secret in the OS keychain (service `seed-hypermedia-vault-secret-v2`, account `local`).

This local file is not the hosted [vault](../software/vault.md) service. The hosted vault keeps keys for the [web app](../software/web.md).

## The keyring

The keyring is where `seed-cli key generate` and `key import` save keys. On macOS it is the Keychain, and the CLI reads it with `security`. On Linux it is the Secret Service, and the CLI reads it with `secret-tool`. The CLI's keyring code does not work on Windows, so on Windows use a key file (see "Move a key"). <!-- id:UH63EivA -->

The exact format, if you need to read it from another program:

- There is one record per service: `seed-daemon-main`, or `seed-daemon-dev` with `--dev`. Its account name is `parentCollection`.
- The record is a JSON map from key name to a base64 value. The value is the 68-byte libp2p Ed25519 protobuf: a 4-byte header, the 32-byte seed, then the 32-byte public key.
- The daemon stores the record as `go-keyring-base64:<base64 of the JSON>`. The CLI reads that form and plain JSON, and writes the daemon's form.

## When a key is in both

The vault wins. A daemon that has moved its keys into the vault archives its keyring record, so the keyring copy is the old one. <!-- id:xkt3UdnI -->

## Names and ids

A stored key has a name and an account id. They are different things. <!-- id:IJCSwM4b -->

- A **name** is a local label, such as `main`, `imported` or `hm-sync-hypermedia-a1b2c3d4`. The same name on two machines can be two different keys. Never use a name to say who someone is.
- The **account id** comes from the key itself. It is the same everywhere.

When a daemon registers a key without a name, it uses the account id as the name. That is why `key list` sometimes shows the same value in both columns. Every CLI command that takes `-k` accepts a name or an account id.

The key commands are `key generate`, `import`, `list`, `show`, `default`, `rename`, `remove`, `derive` and `export`. [Seed CLI](./cli.md) lists their flags. <!-- id:Yv8bNADI -->

# Move a key: the .hmkey.json file <!-- id:YUkD6tE4 -->

The app, the vault and the CLI all read and write one file format for a key. `seed-cli key export [nameOrId]` writes `<accountId>.hmkey.json`, readable only by you (mode 0600). The key export in the app's Settings makes the same file. <!-- id:sWN_YF8h -->

```json <!-- id:d2a3FEu8 -->
{
  "createTime": "2026-09-16T10:00:00.000Z",
  "publicKey": "z6Mk…",
  "keyB64": "<base64 of the 32-byte seed>",
  "profile": {"name": "…"}
}
```

With `--password` the seed is encrypted. Then `keyB64` holds the encrypted seed, and an `encryption` object records `kdf: argon2id` with its parameters and `cipher: xchacha20poly1305`. <!-- id:Va9wkuoB -->

In the SDK, `keyfile.load(json, password?)` returns the seed, and `keyfile.create({publicKey, key, password?, profile?})` builds the file's content.

A file without a password is the account. Keep it where you would keep a private key.

# Sign on a machine with no screen <!-- id:RuLAAJzM -->

A server, a CI job or a bot has no keychain and no app. You give the CLI a key through one of two environment variables: <!-- id:bM4_vCMu -->

<!-- id:Ge4eUtqj -->
| Variable <!-- col:wKVQ3W14 --> | Holds <!-- col:-4S6j8z6 --> <!-- id:rWCRis6h --> |
| --- | --- |
| `SEED_CLI_KEYFILE` | the whole contents of an unencrypted `.hmkey.json` <!-- id:Q2w6BNQv --> |
| `SEED_CLI_MNEMONIC` | a BIP-39 phrase <!-- id:r2gsjvdS --> |

The rules: <!-- id:cpAnGSI9 -->

- Set only one of them. The CLI stops with an error when both are set.
- The variable wins over every stored key. `-k` may only name that same account.
- Prefer the file over a mnemonic. A seed cannot be turned back into words, so a key that the app made can only travel as a file.

The Seed repository [publishes this documentation](../contribute/editing-these-docs.md) this way. The workflow puts a repository secret into `SEED_CLI_KEYFILE` and runs the push script. The [site](../protocol/sites.md) is that key's own [space](../protocol/spaces.md).

A machine with no screen that runs a daemon can also read the daemon's vault. Point the CLI at the file and pass the vault's secret directly. <!-- id:GvSPYnk9 -->

```sh <!-- id:1g2zj9DO -->
SEED_VAULT_PATH=/srv/seed/daemon/vault.json SEED_VAULT_KEK="$(base64 < kek.bin)" seed-cli key list
```

In your own code, load the seed and build a signer with the [SDK](./sdk.md). Use `keyfile.load` and then `nobleKeyPairFromSeed`, or `loadLocalVaultAccounts` from the `vault-local` module. Every SDK builder accepts that signer. <!-- id:1VB3OAvz -->

# A key for a bot <!-- id:pp4K7-sO -->

A script or an agent should not hold a person's account key. Give it a key of its own. Then the account gives that key a [capability](../protocol/permissions.md), a signed permission to write: <!-- id:zhAoL_eY -->
  1. On the bot's machine, run `seed-cli key generate -n bot --show-mnemonic` and keep the words. If the machine has no keyring, export a key on another machine with `seed-cli key export` and put the file's contents in `SEED_CLI_KEYFILE`. <!-- id:R5BIcYGg -->
  2. Note the bot's account id from `seed-cli key show bot`. <!-- id:-XktdlEH -->
  3. With the account that owns the space, run `seed-cli capability create --delegate <bot-id> --role WRITER --path /reports`. <!-- id:Pof_FYSP -->
  4. The bot can then write: `seed-cli document create -a <space-uid> -p reports/today -f today.md -k bot`. The CLI finds the capability and attaches it. `document update` and `document delete` find the capability without the `-a` flag. <!-- id:zqWAR1zi -->

Which [role](../protocol/permissions.md) to choose: <!-- id:wDZSQyGA -->

- `WRITER` means "may write".
- `AGENT` means "acts on behalf of". It fits a key that should only act as the account.

A capability cannot be taken back. So limit it to a path, and replace the bot's key when you are in doubt. [Permissions](../protocol/permissions.md) explains the roles.

The signature shows who wrote what. Every change and [comment](../protocol/comments.md) the bot publishes names the bot's key as its signer, and the capability links the bot to the account. Give the bot a [profile](../profile.md) so readers see who it is: `seed-cli account profile set --name "Reports bot" -k bot`. <!-- id:xJOCwRyM -->

The same pattern appears in other places: <!-- id:hZ3ZrE3A -->

- A browser app gets a session key with a capability through [Sign in with Seed](./sign-in.md).
- [Seed Agents](../agent.md) keep their signing identities as encrypted secrets on the [app environment](../software/app-environment.md), the server that runs them. You create one with `CreateSigningIdentity` or import one as a 32-byte seed. Each agent's definition lists which identities it may sign with.
- [Using Seed from your own agent](./agents.md) builds on the four steps here.

# See also <!-- id:Z5lNFKnj -->

- [Identity](../protocol/identity.md), for how words become a key, every key store, linking keys, and recovery. <!-- id:YDnNfseC -->
- [Principal](../principal.md) <!-- id:b7J_h__z -->
- [Permissions](../protocol/permissions.md) and [Capability](../capability.md) <!-- id:ttAA_xal -->
- [Privacy](../protocol/privacy.md), for the bearer token that reads private content. <!-- id:wY8hzkYw -->
- [Sign in with Seed](./sign-in.md) <!-- id:4oj8Ks-5 -->
- [Using Seed from your own agent](./agents.md)
- [Seed CLI](./cli.md) <!-- id:4M_T7OSx -->
- [SDK](./sdk.md), for signers and the key helpers. <!-- id:AG3rOWai -->
