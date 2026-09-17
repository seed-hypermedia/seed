---
name: The identity vault
summary: The Bun service at hyper.media/vault that stores a person's account keys end-to-end encrypted, signs them in with a passkey or password, lets websites act for them through delegated session keys, and syncs keys to the desktop and mobile apps.
---
The vault is where a person's Hypermedia [account](../protocol/identity.md) keys live when they do not want to manage a recovery phrase. It works like a password manager: the keys are encrypted in the browser with a key only the person can derive, and the server stores ciphertext it cannot read. From the vault a person creates an account, signs in with a passkey or a password, approves websites that want to act for them, and connects the desktop and mobile apps so the same accounts appear there. The hosted vault is `https://hyper.media/vault`, and in the interface it is called "Identity". <!-- id:CVIMFwRf -->

# Where the code is <!-- id:F28qoZtC -->

`vault/`, package `@seed-hypermedia/vault`: a separate Bun workspace outside the pnpm workspace. The server is `Bun.serve` with `bun:sqlite`; the frontend is a React single-page app with react-router and [Valtio](https://valtio.dev) for state, built by `bun build.ts`. It consumes `@seed-hypermedia/client`, `@shm/shared` and `@shm/ui` through `file:` dependencies, which copy the packages at install time. <!-- id:GaH2Dd4P -->

<!-- id:KEdf5KKS -->
| Path <!-- col:A_8ykmTK --> | What it holds <!-- col:W_gwTF0Y --> <!-- id:eVUtTzMv --> |
| --- | --- |
| `src/main.ts` | The HTTP server and route table. <!-- id:3fT32Aao --> |
| `src/config.ts` | Every flag, its environment variable and default. Configuration is read only here. <!-- id:EHfTiiy3 --> |
| `src/api.ts` | Request and response types, the encryption invariant and the authentication rules, as one contract for client and server. <!-- id:xEI2xExk --> |
| `src/api-service.ts` | The handlers. <!-- id:bqUk9SEK --> |
| `src/sqlite-schema.sql`, `src/sqlite.ts` | The schema and its version check. <!-- id:HnUJogGP --> |
| `src/frontend/store.ts` | The app's logic: login, vault decryption, [profile](../protocol/identity.md) publishing, [delegation](../protocol/permissions.md), vault connect. <!-- id:7woqPrGI --> |
| `src/frontend/crypto.ts`, `src/frontend/views/` | Browser crypto helpers (WebAuthn, PRF) and the screens. <!-- id:8vG4Eds9 --> |

The cryptography itself, key derivation and encryption, is in the [SDK](../build/sdk.md) (`@seed-hypermedia/client/vault` and `/encryption`), so the browser and the [mobile app](./mobile.md) share one implementation. The [daemon](./daemon.md), which holds the [desktop app](./desktop.md)'s side of a connected vault, has its own Go implementation. <!-- id:prJkVv5H -->

# The zero-knowledge design <!-- id:fFrX4C0Y -->

Each person has one random data encryption key (DEK). It encrypts the vault: the [account](../protocol/identity.md) private keys, the list of delegations the person approved, and settings such as the notify server. The server stores that ciphertext in `users.encrypted_data`, with a version number for optimistic concurrency, so two devices saving at once cannot silently overwrite each other. <!-- id:oUpOHZQb -->

Each way of signing in is a credential that wraps the DEK with its own key, and the server stores only the wrapped copy. <!-- id:Oh-zX468 -->

<!-- id:yWLEZbvK -->
| Credential <!-- col:_ytU4HZH --> | How the client derives its keys <!-- col:f_-H1zur --> | What the server keeps <!-- col:OPoBLufG --> <!-- id:m7gGjZlf --> |
| --- | --- | --- |
| Passkey | The [WebAuthn PRF extension](https://w3c.github.io/webauthn/#prf-extension) yields a secret the authenticator reproduces on every login. | Attestation data and the wrapped DEK. <!-- id:6Ua8C5a_ --> |
| Password | [Argon2id](https://datatracker.ietf.org/doc/html/rfc9106) in the browser, with the email as salt. | An Argon2id hash of the authentication half and the wrapped DEK. <!-- id:TFBLQ015 --> |
| Secret | A full-entropy random secret, used by the [desktop app](./desktop.md) after vault connect; no Argon2id needed. | A SHA-256 hash of the authentication half and the wrapped DEK. <!-- id:fiTlMH9k --> |

The derivation splits into two halves. The authentication key goes to the server and proves who you are; the encryption key never leaves the client and is the only thing that unwraps the DEK. Encryption is [XChaCha20-Poly1305](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha). <!-- id:Pw1-vmAW -->

If you lose every credential and have no exported key or recovery phrase, nobody can recover your accounts. Email proves you own an address, with a 4-digit code and three attempts, but it cannot decrypt anything. The design also trusts the vault's origin to serve honest JavaScript, which is why the hosted vault lives on hyper.media and other [sites](../protocol/sites.md) redirect people there to sign in. <!-- id:rE2xi8WD -->

# How it talks to the daemon <!-- id:Hrppx-5u -->

The vault uses the [daemon](./daemon.md) behind the same [site](../protocol/sites.md) for three things. <!-- id:ynKuIVJT -->
  - **Publishing.** [Account](../protocol/identity.md) creation and [delegation](../protocol/permissions.md) build [profile](../profile.md) and [capability](../capability.md) [blobs](../protocol/blobs.md) in the browser, signed with the decrypted account key, and upload them to `<backend>/ipfs/<cid>` on the site's daemon. <!-- id:jb4aggOT -->
  - **Reading accounts.** `GET /vault/api/accounts/:id` calls the daemon's `GetAccount` over gRPC-web. <!-- id:PCzHu9o6 -->
  - **Email prevalidation.** When the vault returns a person's data, it signs `{email, signer, host}` with the first key in its daemon's keystore through `SignData`. A [notify service](./notify.md) that trusts this vault accepts that signature instead of sending its own verification email. <!-- id:PN749lGL -->

# Delegation: Sign in with Seed <!-- id:ivOSZ-oq -->

A website that wants a visitor to [comment](../protocol/comments.md) or edit as their [account](../protocol/identity.md) sends them to `/vault/delegate` with a signed request naming a browser session key. The vault authenticates the person, shows a consent screen naming the [site](../protocol/sites.md)'s origin, signs an `AGENT` [capability](../protocol/permissions.md) from the chosen account to the session key, records the delegation in the encrypted vault, and redirects back. The [web app](./web.md) uses this for its own sign-in, and any third-party site can use it with the [SDK](../build/sdk.md). The whole ceremony, with the parameters and checks, is in [Sign in with Seed](../build/sign-in.md). <!-- id:N5G9AB46 -->

# Vault connect: desktop and mobile <!-- id:PpFBx4T8 -->

The [desktop app](./desktop.md) keeps a local vault in its [daemon](./daemon.md), and can connect it to a remote vault so the same [accounts](../protocol/identity.md) appear everywhere. The connection is a short handshake through the vault server. <!-- id:gwerIvmN -->
  1. The app mints a 32-byte token, opens `/vault/connect` in the browser with the token in the URL fragment, and polls `/vault/api/vault-connect/<id>`, where the id is a hash of the token. <!-- id:0G7NMk6L -->
  2. After consent, the browser creates a secret credential for the device, encrypts the credential and vault location with the token, and posts it to that mailbox. <!-- id:IW6xUUxQ -->
  3. The app picks it up, the server deletes it, and the app can now open and sync the vault on its own. Pending mailboxes expire after 15 minutes. <!-- id:rMPZ1AB3 -->

The server only ever sees the encrypted payload; the token travels in the fragment, which browsers do not send. The daemon implements the device side in `backend/storage/vault`, and the [mobile app](./mobile.md) ports it in `frontend/apps/mobile/src/vault/connect.ts`. <!-- id:odUkeK9B -->

# Routes <!-- id:_PcNc-J1 -->

<!-- id:ZpqHLlkc -->
| Route <!-- col:H1FpMbDk --> | Purpose <!-- col:CGY2OlRR --> <!-- id:eXKYzCXi --> |
| --- | --- |
| `/vault`, `/vault/*` | The app: login, choose credential, verify email, create [profile](../protocol/identity.md), delegate, connect, settings. <!-- id:tEXyrgeg --> |
| `/vault/api/config` | Public config: backend URL, notify server, web base URL. <!-- id:Orj54V7z --> |
| `/vault/api/pre-login`, `/login`, `/login/passkey/*`, `/register/*`, `/logout`, `/session` | Authentication, with an HTTP-only session cookie. <!-- id:2R0qLu9z --> |
| `/vault/api/vault` | Read and save the encrypted vault. <!-- id:4afqtp5d --> |
| `/vault/api/credentials/*`, `/vault/api/email-change/*`, `/vault/api/vault-email` | Manage passkeys, passwords, device secrets and the email address. <!-- id:QqIIN__G --> |
| `/vault/api/vault-connect`, `/vault/api/vault-connect/:id` | The connect mailbox. <!-- id:uhkZRkdi --> |
| `/vault/api/accounts/:id` | Account lookup through the [daemon](./daemon.md). <!-- id:6c_labv8 --> |

# Configuration <!-- id:RdYLeQPF -->

Every setting is a flag with an environment variable behind it. <!-- id:r5otBYl0 -->

<!-- id:dpwi-9OX -->
| Flag <!-- col:nqd9mgsJ --> | Variable <!-- col:1hyrhRBI --> | Default <!-- col:GiUpHUxP --> <!-- id:XgD3dClc --> |
| --- | --- | --- |
| `--server-port` | `SEED_VAULT_HTTP_PORT` | 3000 (3030 in development) <!-- id:KGshT5r_ --> |
| `--server-hostname` | `SEED_VAULT_HTTP_HOSTNAME` | `0.0.0.0` <!-- id:DXlfrAxt --> |
| `--rp-id`, `--rp-origin` | `SEED_VAULT_RP_ID`, `SEED_VAULT_RP_ORIGIN` | required; the WebAuthn relying party, `hyper.media` in production <!-- id:MIYCiA6k --> |
| `--db-path` | `SEED_VAULT_DB_PATH` | `./data/vault.sqlite`, `/data/vault.sqlite` in the image <!-- id:VhY74adO --> |
| `--backend-http-base-url` | `SEED_VAULT_BACKEND_HTTP_BASE_URL` | the relying-party origin <!-- id:O1Bmd2rW --> |
| `--backend-grpc-base-url` | `SEED_VAULT_BACKEND_GRPC_BASE_URL` | the backend HTTP URL <!-- id:wc1QXIWQ --> |
| `--web-base-url` | `SEED_VAULT_WEB_BASE_URL` | same origin <!-- id:YyzzqcLE --> |
| `--smtp-*` | `SEED_VAULT_SMTP_*` | unset, which disables email <!-- id:vGM4RTQy --> |
| none | `SEED_VAULT_DEFAULT_NOTIFY_SERVER` | `https://notify.seed.hyper.media` <!-- id:Lci_Ngam --> |

The database schema carries a version. If it does not match the code, the server starts in a mode that only shows a schema-mismatch page and tells you to delete the database; there are no migrations yet. <!-- id:HO_6v9PS -->

# Running it <!-- id:A0Kg0MQc -->

```sh <!-- id:F2Io5mhz -->
cd vault
bun run dev      # :3030 with hot reload, against notify on :3060 and the web app on :3000
bun check        # typecheck and format
bun test
```

`./dev up` runs it as the `vault` pane. In development it proxies `/hm/api/config` to the [web app](./web.md) on port 3000. The web app finds it through `WEB_IDENTITY_ORIGIN` or `SEED_IDENTITY_DEFAULT_ORIGIN`, `http://localhost:3030` in development and `https://hyper.media` by default. Images are `seedhypermedia/vault:dev` and `seedhypermedia/vault:latest`; in the hosted deployment a reverse proxy sends `hyper.media/vault` and `dev.hyper.media/vault` to it. <!-- id:cKbVgfWg -->

# Working with it <!-- id:69sus5M4 -->

## In the Seed app <!-- id:tem5R7L_ -->

Account settings in the [desktop app](./desktop.md) switch between the local vault and a remote one, start vault connect, and manage the email, password and notify server of a connected vault. Connected accounts sign through the local [daemon](./daemon.md) as before. <!-- id:AgHzk374 -->

## CLI <!-- id:w6gtUmyO -->

The [CLI](./cli.md) does not talk to the vault server. It reads the desktop app's local `vault.json`, and it can import an `.hmkey.json` exported from the vault; see [Keys](../build/keys.md). <!-- id:N04L1VC7 -->

## SDK <!-- id:iI516WkM -->

`@seed-hypermedia/client/hmauth` implements the client side of [delegation](../protocol/permissions.md): `startAuth`, `handleCallback` and `createSessionSigner`. The vault crypto helpers are exported for other clients. <!-- id:Yfecst21 -->

## Web API <!-- id:8gBDGaX- -->

Everything under `/vault/api` is JSON over HTTPS and belongs to the vault app. It is separate from the [Seed API](../build/web-api.md). Third parties should use the delegation redirect. These routes are for the vault's own frontend. <!-- id:ZcAjTycJ -->

## Agents <!-- id:8NPHnwWz -->

Agents do not sign in through the vault. An agent acts with its own key and a capability delegated to it; see [Building agents on Seed](../build/agents.md). <!-- id:pmsCRFLK -->

# Where this is going <!-- id:f0IHrcql -->

As of September 2026: paper keys as another credential, social recovery, and a clearer answer to why a person might need both a [recovery phrase](../protocol/identity.md) and a password are open. The team has also discussed moving notification subscriptions and read status into the vault. <!-- id:lYnOHDb8 -->

# See also <!-- id:2v3pC_Ku -->

- [Sign in with Seed](../build/sign-in.md), [Keys](../build/keys.md), [Identity](../protocol/identity.md) <!-- id:odhTeckE -->
- [The web app](./web.md), [The notify service](./notify.md), [The mobile app](./mobile.md) <!-- id:thZZgz3X -->
