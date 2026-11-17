---
name: Identity
summary: In Hypermedia an account is a key pair that you hold, and profiles, devices and sessions are all made by signing statements with that key.
---
In Hypermedia you do not sign up anywhere. An account is a key pair: two matching keys, one private and one public. You keep the private key, and it signs everything you publish. The public key is your account ID. Other people use it as your address. <!-- id:hj19LTna -->

A profile, a linked device and a browser session are all signed [blobs](./blobs.md) that point back at that key. This page explains how a key becomes an account, how the account ID is written, and where keys are stored. It also explains how a profile gives a key a name, how several keys join into one identity, and what you can do if a key is lost. <!-- id:qJinh2-4 -->

# How it works <!-- id:hCLLYxrh -->

## An account is a key <!-- id:2vZHw7Hw -->

The [Seed daemon](../software/daemon.md) accepts two kinds of key: <!-- id:xIsj0I68 -->

- [Ed25519](https://ed25519.cr.yp.to/). Every key the daemon creates itself is of this kind.
- ECDSA [P-256](https://en.wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm). The daemon accepts these so that keys made by a browser's [WebCrypto](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) API can sign blobs.

The web sign-in flow makes Ed25519 keys in WebCrypto, so new browser identities are Ed25519 too. Some web identities on hyper.media are P-256 keys.

The daemon has no account object. An account is the public key, and so is the [space](./spaces.md) of [documents](./documents.md) it owns. Every [resource](../protocol.md#a-note-on-words) in that space has an address of the form `hm://<account>/<path>`. The account's [home document](./spaces.md) is the address with an empty path. See [Spaces and paths](./spaces.md) for the space side, and [Sites](./sites.md) for how a space becomes a website. <!-- id:P8Wl69sj -->

<!-- id:j-JWEBuS -->
| Term <!-- col:rTOET9Q2 --> | Meaning <!-- col:DvS4peL2 --> <!-- id:pPGyWSi4 --> |
| --- | --- |
| account | the key pair, named by its public key <!-- id:BoJT-mj1 --> |
| account ID, principal | the public key in its packed, base58 form (`z6Mk…`) <!-- id:N14NM-vw --> |
| space | the namespace of documents that the account owns <!-- id:414w_kLT --> |
| site | a space published at a web domain <!-- id:Yj32Fhpp --> |
| device key | the libp2p peer identity of one daemon; it never signs content <!-- id:BE4hAXuJ --> |

A web domain and a key are bound in two places. The site reports the key as `registeredAccountUid`, and the key's home document names the site in `siteUrl`. See [Sites](./sites.md).

## Principals <!-- id:eMVLfT0z -->

On the wire, a public key is written as a [principal](../principal.md): the key's multicodec code followed by the raw key bytes. As text it is a base58 string. The string starts with `z6Mk` for an Ed25519 key and `zDn` for a P-256 key. The [principal](../principal.md) type page has the byte layout. <!-- id:5eO2Qc3t -->

``` <!-- id:oQALbxFe -->
z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS    an Ed25519 account
zDnaeTtfA5…                                          a P-256 (WebCrypto) account
```

## Mnemonics and derivation <!-- id:8N7hfLaD -->

An account that a person holds starts as a mnemonic: a list of words that stands for the key. The steps are: <!-- id:raH-4KP_ -->

- The mnemonic follows [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki). It has 12, 15, 18, 21 or 24 words, and you may add a passphrase.
- The daemon turns the words and the passphrase into a seed.
- It walks the [SLIP-10](https://github.com/satoshilabs/slips/blob/master/slip-0010.md) path `m/44'/104109'/0'`. The number 104109 is the Unicode code points of `h` and `m` written one after the other.
- It uses the resulting 32 bytes directly as the Ed25519 private seed.

A different passphrase gives a different account, and that account is just as valid. No code increments the last path segment, so one mnemonic is one account. The daemon can generate any of the five lengths. The [CLI](../build/cli.md) generates 12 or 24 words.

The daemon stores a registered key under a local name. The default name is the principal string. A key name is a local alias, and it is never the principal. The [CLI](../build/cli.md) and the RPCs accept either one, but only the principal means anything to other people. See [Keys](../build/keys.md) for the exact commands. <!-- id:BFE0h6v8 -->

## Device keys <!-- id:novms8gL -->

A device key is not an account key. Each daemon has its own Ed25519 key, and that key is its [libp2p](https://libp2p.io/) [peer](./network.md) identity. It authenticates connections and does nothing else. It never signs a blob, and no table ties a peer to an account. <!-- id:CKqd0cPH -->

Sometimes a peer must prove that it holds an account. Then it signs a short-lived (ephemeral) [capability](./permissions.md) that names the account and the remote peer. That proof stays in memory for as long as the connection lasts. [Network](./network.md) covers peer authentication, and [Privacy](./privacy.md) covers what access it grants.

## Where private keys live <!-- id:Rxolfuqs -->

<!-- id:m9LlYGGU -->
| Store <!-- col:BDQH2YsO --> | Used by <!-- col:iwA0zdbc --> | Notes <!-- col:FHsbaJDU --> <!-- id:l5x-4v3u --> |
| --- | --- | --- |
| local vault | the [Seed app](../software/desktop.md)'s daemon, read by the Seed CLI | an encrypted `vault.json` in the daemon's data directory, whose encryption secret sits in the OS keychain; optionally synced to a remote [vault](../software/vault.md) service, which never sees keys in the clear <!-- id:xaiX8xBP --> |
| OS keyring | the Seed CLI, older app installs | one keychain item per environment (`seed-daemon-main`, `seed-daemon-dev`) holding every key as JSON; the daemon migrates it into the local vault and archives it; `seed-cli key generate` and `import` write here <!-- id:O61kspP4 --> |
| file keystore | self-hosted sites, tests | a plaintext `account_keys.json` in the directory named by the daemon's `-keystore-dir` flag; the flag's own help calls it insecure <!-- id:BnWPE6-9 --> |
| web vault | the Seed web app on hyper.media | an encrypted vault on the vault service; the private key never reaches the server in the clear <!-- id:gnVrQ8qf --> |
| key file | the Seed CLI, CI | an exported `.hmkey.json`, optionally encrypted with a password (argon2id and XChaCha20-Poly1305) <!-- id:AEnbswmH --> |
| environment | the Seed CLI in scripts | `SEED_CLI_KEYFILE` (file contents) or `SEED_CLI_MNEMONIC` <!-- id:4DSUsHyP --> |
| browser IndexedDB | the Seed web app | a non-extractable WebCrypto session key, delegated from a vault account <!-- id:YT-1OhNF --> |

The [vault](../software/vault.md) stores your identity for the browser on hyper.media. Your account keys sit in an encrypted blob. Only a password or a passkey can decrypt it, and the server that holds the blob cannot read it. When a site wants to act for you, the vault keeps the account key. It signs a capability that delegates a fresh browser session key. Key linking below and [Sign in with Seed](../build/sign-in.md) describe this. <!-- id:o4xR9Tio -->

## Profiles <!-- id:BIeeNLIw -->

A [profile](../profile.md) is a small signed blob. It gives an account a display name, an avatar and a description. Profiles are always public. An account can have many profile blobs, and readers merge them field by field. The [profile](../profile.md) type page has the fields and the merge rule. The home document is separate from the profile; see [Spaces and paths](./spaces.md). <!-- id:pVQNUcV5 -->

## Key linking: several keys, one identity <!-- id:l5gHckMX -->

Most people end up with more than one key. A desktop app holds one, a phone holds one, and so does every browser origin where you write a [comment](./comments.md). Linking them uses the same blobs as everything else: <!-- id:s4Q12SkD -->
  1. The main account signs a [capability](../capability.md) with role `AGENT` and an empty path, naming the other key as delegate. The other key may then write anywhere in the main space and sign profiles for it. <!-- id:sJu7Yxyi -->
  2. The other key publishes a profile whose only field is `alias`, pointing at the main account. The daemon accepts this alias only if step 1 exists. Otherwise it holds the profile aside until the capability arrives. <!-- id:zXvsLIj4 -->
  3. Optionally the other key signs a reverse `AGENT` capability back to the main account. The web sign-in flow publishes this reverse capability so the record goes both ways. It lets the main account write as the other key, so the two keys can act for each other. <!-- id:ed9cZE0G -->

Once an alias exists, the apps show anything the delegated key signs under the main account. A request for the delegated account returns only the alias. This is what happens when you [sign in](../build/sign-in.md) to a site with the vault. The vault signs an AGENT capability to a session key. The site's callback page then publishes that capability, the reverse capability and the alias profile together. <!-- id:CTSx5Z9h -->

The [Permissions](./permissions.md) page has the exact rule for how far a delegated key's authority reaches. In brief: an AGENT key writes wherever the issuer can, in the issuer's own space and in spaces the issuer was granted, and chains of AGENT keys compose. It never gets the issuer's ownership. <!-- id:b5LpEOdJ -->

A session key is a full AGENT delegation. There is no narrower grant that limits a session to one target.

## Proving identity to a server <!-- id:JjYMnAhQ -->

Signing a blob proves who wrote it. Reading private content over HTTP needs something else, because an HTTP request carries no signature. So the daemon issues a bearer token: a secret string that the client sends with each request. It works like this: <!-- id:CVquiYcq -->

- You sign an ephemeral capability that names the daemon's peer.
- The daemon checks that the capability is fresh (within five minutes) and that it already knows your principal.
- The daemon returns a symmetric token that is valid for thirty days.
- The [Seed web app](../software/web.md) stores the token in a cookie and forwards it on every request.

The token only widens what you can read on a server-mode node. It never authorizes a write. See [Integrity](./integrity.md) for the practical effect.

## Recovery and rotation <!-- id:oFA9JF5y -->

The protocol has no key recovery, rotation or revocation beyond what linking gives you. <!-- id:4zMqF3pU -->
  - If you lose the private key and its mnemonic, the account is gone. Nothing can issue it again. <!-- id:FJW-Pwv3 -->
  - If someone steals a key, nothing can revoke it. A capability it holds stays valid forever. <!-- id:S0llU_pT -->
  - The only way to move to a new key is to keep the old key, delegate a new key with `AGENT`, and alias the new key to the old. The old key stays valid; the new key is linked to it. <!-- id:hFTQcG_u -->

To lower the risk: <!-- id:GWJGtL9r -->

- Back up the mnemonic.
- Keep the account key in the vault or the OS keyring, and off servers.
- Give servers and bots their own keys with narrow [WRITER](./permissions.md) grants.

No client builds key rotation, and the daemon has no notion of a "current" key.

# Working with identities <!-- id:R-E_0XLV -->

```sh <!-- id:39_z3gEL -->
seed-cli key generate --name main --words 24 --show-mnemonic   # new account in the OS keyring
seed-cli key import "<your words>" --name imported
seed-cli key list                                              # name, account ID, source (vault or keyring)
seed-cli key derive "<words>"                                  # print the account ID, store nothing
seed-cli key export main -o main.hmkey.json --password '…'     # portable key file
seed-cli account get z6Mk…                                     # merged profile
```

- The CLI reads vault keys and keyring keys. `SEED_CLI_KEYFILE` or `SEED_CLI_MNEMONIC` override both, for use without a person present. The full reference is in [Seed CLI](../build/cli.md). <!-- id:r-A5uaoc -->
- Profile commands are on the [profile](../profile.md) type page. Key files, the keyring and headless use are in [Keys](../build/keys.md). Browser sign-in is in [Sign in with Seed](../build/sign-in.md).
- On the [Seed API](../build/web-api.md), `GET /api/Account?id=<uid>` returns the merged profile. If the account is an alias, it returns the account the alias points at.
- [Seed Agents](../agent.md) hold their own account keys and write as themselves. An external agent, such as Claude Code with the seed-cli skill, uses the CLI commands above. It generates a key once, keeps it in the keyring or a key file, and asks the human to grant it a capability. It should never borrow the human's key. [Using Seed from your own agent](../build/agents.md) walks through it. <!-- id:oxeYf-LV -->

# See also <!-- id:Ugn0v_W9 -->

- [Principal](../principal.md), [Profile](../profile.md), [Capability](../capability.md), [Signature](../signature.md) <!-- id:1_p1tjDa -->
- [Spaces and paths](./spaces.md), [Contacts](./contacts.md)
- [Permissions](./permissions.md), [Privacy](./privacy.md), [Integrity](./integrity.md) <!-- id:G5h8fKGn -->
- [Keys](../build/keys.md), [Sign in with Seed](../build/sign-in.md) <!-- id:UwAgyJTm -->
- [Why signed content](../why/signed-content.md) <!-- id:4jHh0rX0 -->
- [Glossary](../glossary.md) <!-- id:jAF-Dxv7 -->
