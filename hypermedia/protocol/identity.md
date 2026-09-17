---
name: Identity
summary: In Hypermedia an account is a cryptographic key pair, so identity is something you hold rather than something a server grants, and everything else (profiles, devices, sessions) is built by signing statements with that key.
---
In Hypermedia there is no sign-up form and no user table. An account is a key pair: the private half stays with you and signs everything you publish, and the public half is your account ID, the address other people use to find you. A profile, a linked device, a browser session are all just signed statements that point back at that key.

This page explains how keys become accounts, how the account ID is written, how keys are stored, how a profile attaches a name to a key, and how several keys are linked into one identity. It ends with what exists for recovery and rotation, which is less than you might hope, and with what each Seed surface offers for working with identities.

# How it works

## An account is a key

The Seed daemon registers two key types. Every key it creates itself is [Ed25519](https://ed25519.cr.yp.to/). It also accepts ECDSA [P-256](https://en.wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm) keys, which exist so that keys created by a browser's [WebCrypto](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) API can sign blobs. Older web identities on hyper.media were P-256 keys. The current web sign-in flow generates Ed25519 keys in WebCrypto, so new browser identities are Ed25519 too.

There is no account object anywhere in the daemon. An account, and the space of documents it owns, is simply the public key. Every resource in that space has an address of the form `hm://<account>/<path>`, and the account's home document is the address with an empty path. See [Sites](./sites.md) for how a space becomes a website.

| Term | Meaning |
| --- | --- |
| account | the key pair, named by its public key |
| account ID, principal | the public key in its packed, base58 form (`z6Mk…`) |
| space | the namespace of documents that the account owns |
| site | a space published at a web domain |
| device key | the libp2p peer identity of one daemon; it never signs content |

## Principals

The wire form of a public key is a [principal](../principal.md): the key's [multicodec](https://github.com/multiformats/multicodec) code as an unsigned varint, followed by the raw key bytes. For Ed25519 the code is `0xed`, so a principal is 34 bytes: the two bytes `ed 01` and then the 32-byte key. Inside DAG-CBOR blobs a principal is a byte string, not text.

The text form is [multibase](https://github.com/multiformats/multibase) base58btc of those bytes, which is why every account ID begins with `z`. An Ed25519 principal always starts with `z6Mk`, which is exactly the [did:key](https://w3c-ccg.github.io/did-key-spec/) encoding of an Ed25519 key; a P-256 principal starts with `zDn`. Anything that accepts a principal accepts either the text form or the raw bytes, and rejects a key of the wrong length.

```
z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb    an Ed25519 account
zDnaeTtfA5…                                          a P-256 (WebCrypto) account
```

The daemon also derives a 56-bit actor ID from each principal (the first bytes of its SHA-256 hash) and uses it inside CRDT operation IDs; see [Documents](./documents.md).

## Mnemonics and derivation

A human-held account starts as a [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) mnemonic of 12, 15, 18, 21 or 24 words, with an optional passphrase. The daemon turns the words and passphrase into a seed, walks the [SLIP-10](https://github.com/satoshilabs/slips/blob/master/slip-0010.md) path `m/44'/104109'/0'` (104109 is the Unicode code points of `h` and `m` written one after the other), and uses the resulting 32 bytes directly as the Ed25519 private seed. A different passphrase yields a different, equally valid account. Nothing in the code increments the last path segment, so one mnemonic is one account.

The daemon stores a registered key under a local name (default: the principal string). A key name is a local alias and is never the same thing as the principal; the CLI and the RPCs accept either, but only the principal is meaningful to anyone else. See [Keys](../build/keys.md) for the exact commands.

## Device keys are not account keys

Each daemon has a separate Ed25519 key that is its [libp2p](https://libp2p.io/) peer identity. It authenticates connections and nothing else. It never signs a blob, and a peer is not tied to an account in any table. When a peer needs to prove that it holds an account, it signs a short-lived ephemeral capability naming the account and the remote peer; that proof lives in memory for the length of the connection. The [Network](./network.md) page covers peer authentication, and [Privacy](./privacy.md) covers what it unlocks.

## Where private keys live

| Store | Used by | Notes |
| --- | --- | --- |
| OS keyring | the Seed app, the Seed CLI | one keychain item per environment (`seed-daemon-main`, `seed-daemon-dev`) holding every key as JSON |
| file keystore | self-hosted sites | a plaintext `account_keys.json` in the data directory; meant for servers, chosen with the daemon's `-keystore-dir` flag |
| vault | the Seed web app on hyper.media, the desktop app since 2026 | an encrypted vault, optionally synced to a remote vault service; the private key never reaches the server in the clear |
| key file | the Seed CLI, CI | an exported `.hmkey.json`, optionally encrypted with a password (argon2id and XChaCha20-Poly1305) |
| environment | the Seed CLI in scripts | `SEED_CLI_KEYFILE` (file contents) or `SEED_CLI_MNEMONIC` |
| browser IndexedDB | the Seed web app | a non-extractable WebCrypto session key, delegated from a vault account |

The vault deserves a sentence of its own. It is the browser-side identity store on hyper.media: your account keys sit in an encrypted blob that only a password or passkey can unwrap, and the server holding the blob cannot read it. When a site wants to act for you, the vault does not hand over the account key. It signs a capability that delegates a fresh browser session key, as described under key linking below and in [Sign in with Seed](../build/sign-in.md).

## Profiles

A [profile](../profile.md) is a small signed blob that attaches a display name, an avatar and a description to an account. It is a snapshot blob: every update is a whole new blob, and readers merge them. When the daemon serves an account it collects every profile blob signed for that space and merges them field by field, keeping the newest value of each field by timestamp. So a name from one device and an avatar from another combine rather than overwrite.

Profiles are always public. A profile signed by a delegated key carries an `account` field naming the account it describes, and the daemon rejects it unless that account issued the signer an AGENT [capability](../capability.md). The home document is separate from the profile: the profile gives the name and picture, the home document gives the site's content and its `siteUrl`.

## Key linking: several keys, one identity

You will end up with more than one key. A desktop app, a phone, and every browser origin you comment from each hold their own. Linking them is done with the same blobs as everything else:

1. The main account signs a [capability](../capability.md) with role `AGENT` and an empty path, naming the other key as delegate. The other key may now write anywhere in the main space and sign profiles for it.
2. The other key publishes a profile whose only field is `alias`, pointing at the main account. The daemon accepts this alias only if step 1 exists; otherwise it holds the profile aside until the capability arrives.
3. Optionally the other key signs a reverse `AGENT` capability back to the main account. The web sign-in flow publishes this reverse capability so the record is bidirectional, but no code reads it today.

Once an alias exists, anything the delegated key signs is shown under the main account, and asking for the delegated account returns only the alias. This is exactly what happens when you sign in to a site with the vault: the vault signs an AGENT capability to a session key, and the site's callback page publishes that capability, the reverse capability and the alias profile together.

The [Permissions](./permissions.md) page has the exact rule for how far a delegated key's authority reaches. The short version: an AGENT key does what the issuer can do in the issuer's own space, and it inherits the issuer's direct grants elsewhere, but only one hop.

## Proving identity to a server

Signing blobs proves authorship. Reading private content over HTTP needs something else, because an HTTP request carries no signature. The daemon issues a bearer token: you sign an ephemeral capability that names the daemon's peer, the daemon checks it is fresh (within five minutes) and that it already knows your principal, and it returns a symmetric token valid for thirty days. The Seed web app stores that token in a cookie and forwards it on every request. The token only widens what you can read on a public-only node; it never authorizes a write. See [Integrity](./integrity.md) for what that means in practice.

## Recovery and rotation

Be honest with yourself here: there is no key recovery, rotation, or revocation in the protocol beyond what linking gives you.

- If you lose the private key and its mnemonic, the account is gone. Nothing can re-issue it.
- If a key is stolen, nothing can revoke it; a capability it holds stays valid forever.
- The only migration path is to keep the old key, delegate a new key with `AGENT`, and alias the new key to the old. That is a link, not a replacement.

Mitigations today: back up the mnemonic, keep the account key in the vault or the OS keyring rather than on servers, and give servers and bots their own keys with narrow WRITER grants instead of the account key. Team notes describe an unambiguous rotation ("I stop using key A, start using key B, signed by both") as something the existing blobs could express, but no client builds it, and the daemon has no notion of "current" key.

# Working with identities

## In the Seed app

Creating an account generates a mnemonic and stores the key in the OS keyring or the local vault. Settings hold the profile (name, avatar, description) and the list of local keys, and the app can export a key file and import one. Signing in on the web goes through the vault: you join or comment, create or unlock your identity with an email code and a passkey or password, and the site receives a delegated session key. Linking a web key to the desktop app is the three-blob dance above.

## CLI

```sh
seed-cli key generate --name main --words 24 --show-mnemonic   # new account in the OS keyring
seed-cli key import "<twelve or twenty-four words>" --name imported
seed-cli key list                                              # name, account ID, source (vault or keyring)
seed-cli key derive "<words>"                                  # print the account ID, store nothing
seed-cli key export main -o main.hmkey.json --password '…'     # portable key file
seed-cli account get z6Mk…                                     # merged profile
seed-cli account profile set --name "Ada" --icon ipfs://… --description "…"
seed-cli account profile set -a z6MkOwner… --name "Ada"        # sign a profile for an account that made you its AGENT
```

The CLI reads vault keys and keyring keys, and `SEED_CLI_KEYFILE` or `SEED_CLI_MNEMONIC` override both for headless use. The full reference is in [Seed CLI](../build/cli.md).

## SDK

`@seed-hypermedia/client` has the primitives under its `blobs` subpath: `principalFromEd25519`, `principalToString`, `principalFromString`, `createProfile`, `createProfileAlias`, and `NobleKeyPair` or `WebCryptoKeyPair` as signers. `keyfile` reads and writes `.hmkey.json`. Browser sign-in is `startAuth`, `handleCallback` and `createSessionSigner` under the `auth` subpath. Every signed blob is published with `client.publish`. See [SDK](../build/sdk.md).

## Web API

`GET /api/Account?id=<uid>` returns the merged profile, following an alias to the account it points at. `GET /api/ListAccounts` lists the accounts a site knows. `POST /hm/api/auth` exchanges a signed authentication request for the bearer cookie, and `DELETE` clears it. `GET /hm/api/config` tells you which account a site is registered to (`registeredAccountUid`) and which key the server signs with (`signerAccountUid`). See [Web API](../build/web-api.md).

## Agents

Seed Agents hold their own account keys: an agent's signing identity is a server-held Ed25519 key created with `CreateSigningIdentity` or imported from a seed, and creating one publishes a profile so the agent has a name. An agent writes as itself and publishes into a person's space only when that space delegated it a capability. Through the `write` verb an agent updates its profile with the `profile.update` action and can publish an alias with `profile.alias`; both accept `dryRun`. See [Write](../agent/write.md).

An external agent such as Claude Code with the seed-cli skill uses the CLI commands above: generate a key once, keep it in the keyring or a key file, and ask the human to grant it a capability rather than borrowing the human's key. [Building agents](../build/agents.md) walks through it.

# Where this is going

As of September 2026 the team's direction, not yet code:

- Domains as a second identity vector next to the key, with both saved in links and contacts and a warning when they disagree. Today the only binding is the site's `registeredAccountUid`.
- Session keys scoped to a target instead of full AGENT delegations.
- Capability revocation, which would make rotation meaningful; see [Permissions](./permissions.md).
- The HM26 redesign folds home documents and profiles into nodes owned by the space; see [Roadmap](./roadmap.md).

# See also

- [Principal](../principal.md), [Profile](../profile.md), [Capability](../capability.md), [Signature](../signature.md)
- [Permissions](./permissions.md), [Privacy](./privacy.md), [Integrity](./integrity.md)
- [Keys](../build/keys.md), [Sign in with Seed](../build/sign-in.md)
- [Why signed content](../why/signed-content.md)
- [Glossary](../glossary.md)
