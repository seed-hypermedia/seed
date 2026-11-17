---
name: The identity vault
summary: The vault is the Seed service that stores a person's account keys in encrypted form, signs them in with a passkey or a password, lets websites act for them through session keys, and syncs keys to the desktop and mobile apps.
---
The vault keeps a person's Hypermedia [account](../protocol/identity.md) keys for them, so they do not have to look after a recovery phrase. It works like a password manager. The browser encrypts the keys with a key that only the person can produce, and the server stores data it cannot read. The hosted vault is `https://hyper.media/vault`. The interface calls it "Identity". <!-- id:CVIMFwRf -->

In the vault a person can do five things:

- Create an account.
- Sign in with a passkey or a password.
- Get back in with recovery words after they forget the password.
- Approve a website that wants to [act for them](../build/sign-in.md).
- Connect the desktop app and the mobile app, so the same accounts appear there.

[Keys](../build/keys.md) covers the other ways to hold a key.

# Where the code is <!-- id:F28qoZtC -->

The code is in `vault/`, package `@seed-hypermedia/vault`. It is a separate Bun workspace, outside the pnpm workspace. The server is `Bun.serve` with `bun:sqlite`. The frontend is a React single-page app with react-router, and with [Valtio](https://valtio.dev) for state. `bun build.ts` builds it. It uses `@seed-hypermedia/client`, `@shm/shared` and `@shm/ui`, three of the [shared packages](./packages.md), through `file:` dependencies, which copy the packages at install time. <!-- id:GaH2Dd4P -->

<!-- id:KEdf5KKS -->
| Path <!-- col:A_8ykmTK --> | What it holds <!-- col:W_gwTF0Y --> <!-- id:eVUtTzMv --> |
| --- | --- |
| `src/main.ts` | The HTTP server and route table. <!-- id:3fT32Aao --> |
| `src/config.ts` | Every flag, its environment variable and default. Configuration is read only here. <!-- id:EHfTiiy3 --> |
| `src/api.ts` | The request and response types, the encryption rule and the authentication rules. It is the one contract between client and server. <!-- id:xEI2xExk --> |
| `src/api-service.ts` | The handlers. <!-- id:bqUk9SEK --> |
| `src/sqlite-schema.sql`, `src/sqlite.ts` | The schema and its version check. <!-- id:HnUJogGP --> |
| `src/frontend/store.ts` | The app's logic: login, decrypting the vault, publishing a [profile](../profile.md), [delegation](../protocol/permissions.md) and vault connect. <!-- id:7woqPrGI --> |
| `src/frontend/crypto.ts`, `src/frontend/views/` | Browser crypto helpers (WebAuthn, PRF, recovery words) and the screens. <!-- id:8vG4Eds9 --> |

The cryptography itself (making keys from secrets, and encryption) is in the [SDK](../build/sdk.md), in `@seed-hypermedia/client/vault` and `/encryption`. So the browser and the [mobile app](./mobile.md) share one implementation. The [daemon](./daemon.md) holds the [desktop app](./desktop.md)'s side of a connected vault, and it has its own implementation in Go. <!-- id:prJkVv5H -->

# The zero-knowledge design <!-- id:fFrX4C0Y -->

"Zero-knowledge" means the server never learns the keys it stores. <!-- id:oUpOHZQb -->

Each person has one random data encryption key (DEK). The DEK encrypts the vault: the account private keys, the list of [delegations](../protocol/permissions.md) the person approved, and settings such as the [notify server](./notify.md). The server stores the encrypted data in `users.encrypted_data` with a version number. A save must name the version it changes. So when two devices save at the same time, one save fails and nothing is lost without notice.

Each way to sign in is a credential. A credential encrypts ("wraps") the DEK with its own key, and the server stores only the wrapped copy. <!-- id:Oh-zX468 -->

<!-- id:yWLEZbvK -->
| Credential <!-- col:_ytU4HZH --> | How the client derives its keys <!-- col:f_-H1zur --> | What the server keeps <!-- col:OPoBLufG --> <!-- id:m7gGjZlf --> |
| --- | --- | --- |
| Passkey | The [WebAuthn PRF extension](https://w3c.github.io/webauthn/#prf-extension) yields a secret the authenticator reproduces on every login. | Attestation data and the wrapped DEK. <!-- id:6Ua8C5a_ --> |
| Password | [Argon2id](https://datatracker.ietf.org/doc/html/rfc9106) in the browser, with the email as salt. | An Argon2id hash of the authentication half and the wrapped DEK. <!-- id:TFBLQ015 --> |
| Secret | A full-entropy random secret, used by the [desktop app](./desktop.md) after vault connect; no Argon2id needed. | A SHA-256 hash of the authentication half and the wrapped DEK. <!-- id:fiTlMH9k --> |
| Recovery words | 12 [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) words chosen at password sign-up encode 128 bits, which HKDF turns into the secret of a secret credential tagged `purpose: 'recovery'`; no Argon2id needed. | The same as a secret. A person has at most one: saving new words deletes the old credential. <!-- id:kNi35SeO --> |

The client makes two keys from each secret. The authentication key goes to the server and proves who you are. The encryption key never leaves the client, and it is the only thing that unwraps the DEK. Encryption is [XChaCha20-Poly1305](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha). <!-- id:Pw1-vmAW -->

**Recovery words.** A person who signs up with a password also saves recovery words: <!-- id:JVj2U_vz -->

- The vault shows the words once. The person copies them, downloads them as a text file, or writes them down.
- If the person forgets the password, they type the words or upload that file. The words sign in through `/vault/api/login/recovery` and unwrap the DEK through their own credential.
- Signing in this way does not reset the password. The person can change it in settings afterwards.
- A password user without recovery words sees a reminder in the vault, and on the consent screen before they return to a site, until they save the words.
- These words open the vault only. They are not the [recovery phrase](../protocol/identity.md) of an account key.

**What cannot be recovered.** If you lose every credential and have no exported key and no recovery phrase, nobody can recover your accounts. Email proves that you own an address, with a 4-digit code and three attempts, but it cannot decrypt anything. There is no credential on paper and no recovery through friends. <!-- id:rE2xi8WD -->

**What the design trusts.** The browser runs the JavaScript that the vault's origin serves, so the design trusts that origin to serve honest code. This is why the hosted vault is on hyper.media, and why other [sites](../protocol/sites.md) send people there to sign in.

# How it talks to the daemon <!-- id:Hrppx-5u -->

The vault uses the [daemon](./daemon.md) of the same [site](../protocol/sites.md) for three things. <!-- id:ynKuIVJT -->
  - **Publishing.** When a person creates an account or approves a delegation, the browser builds [profile](../profile.md) and [capability](../capability.md) [blobs](../protocol/blobs.md) and signs them with the decrypted account key. It uploads them to `<backend>/ipfs/<cid>` on the site's daemon. <!-- id:jb4aggOT -->
  - **Reading accounts.** `GET /vault/api/accounts/:id` calls the daemon's `GetAccount` over gRPC-web. <!-- id:PCzHu9o6 -->
  - **Saying an email is verified.** When the vault returns a person's data, it signs `{email, signer, host}` with the first key in its daemon's keystore, through `SignData`. A [notify service](./notify.md) that trusts this vault accepts that signature and does not send its own verification email. [The notify API](../build/notify-api.md) has the rule. The desktop app reads the same signature through its daemon's `GetVaultEmailPrevalidation` and shows it to the Seed hosting service. So a new user can skip the email login there. <!-- id:PN749lGL -->

# Delegation: Sign in with Seed <!-- id:ivOSZ-oq -->

A website may want a visitor to [comment](../protocol/comments.md) or edit as their account. The website makes a session key in the browser and sends the visitor to `/vault/delegate` with a signed request that names that key. The vault then does this: <!-- id:N5G9AB46 -->

1. It signs the person in.
2. It shows a consent screen that names the origin of the [site](../protocol/sites.md).
3. It signs an `AGENT` [capability](../protocol/permissions.md) from the chosen account to the session key.
4. It records the delegation in the encrypted vault.
5. It sends the person back to the website.

The [web app](./web.md) uses this for its own sign-in. Any other site can use it with the [SDK](../build/sdk.md). [Sign in with Seed](../build/sign-in.md) has the whole exchange, with the parameters and the checks.

# Vault connect: desktop and mobile <!-- id:PpFBx4T8 -->

The [desktop app](./desktop.md) keeps a local vault in its [daemon](./daemon.md). It can connect that vault to a remote vault, so the same accounts appear everywhere. The connection is a short exchange through the vault server. <!-- id:gwerIvmN -->
  1. The app makes a 32-byte token. It opens `/vault/connect` in the browser with the token in the URL fragment. Then it asks `/vault/api/vault-connect/<id>` again and again, where the id is a hash of the token. This address is the mailbox. <!-- id:0G7NMk6L -->
  2. After the person agrees, the browser creates a secret credential for the device. It encrypts the credential and the location of the vault with the token, and posts the result to the mailbox. <!-- id:IW6xUUxQ -->
  3. The app picks it up, the server deletes it, and the app can now open and sync the vault on its own. Pending mailboxes expire after 15 minutes. <!-- id:rMPZ1AB3 -->

The server only ever sees the encrypted message. The token travels in the URL fragment, which browsers do not send to the server. The daemon's code for the device side is in `backend/storage/vault`, and the [mobile app](./mobile.md) has its own copy in `frontend/apps/mobile/src/vault/connect.ts`. <!-- id:odUkeK9B -->

# Routes <!-- id:_PcNc-J1 -->

<!-- id:ZpqHLlkc -->
| Route <!-- col:H1FpMbDk --> | Purpose <!-- col:CGY2OlRR --> <!-- id:eXKYzCXi --> |
| --- | --- |
| `/vault`, `/vault/*` | The app: login, choose credential, verify email, recovery words, create profile, delegate, connect, settings. <!-- id:tEXyrgeg --> |
| `/vault/api/config` | Public config: backend URL, notify server, web base URL. <!-- id:Orj54V7z --> |
| `/vault/api/pre-login`, `/login`, `/login/recovery`, `/login/passkey/*`, `/register/*`, `/logout`, `/session` | Authentication, with an HTTP-only session cookie. <!-- id:2R0qLu9z --> |
| `/vault/api/vault` | Read and save the encrypted vault. <!-- id:4afqtp5d --> |
| `/vault/api/credentials/*`, `/vault/api/email-change/*`, `/vault/api/vault-email` | Manage passkeys, passwords, device secrets and the email address. <!-- id:QqIIN__G --> |
| `/vault/api/vault-connect`, `/vault/api/vault-connect/:id` | The connect mailbox. <!-- id:uhkZRkdi --> |
| `/vault/api/accounts/:id` | Account lookup through the daemon. <!-- id:6c_labv8 --> |
| `/vault/api/vault-accounts` | The app reports the public account IDs its vault holds, each claim signed by that account's key. See [Running an invite-only vault](../operate/invite-only-vault.md). <!-- id:N__67wnD --> |
| `/vault/api/invitations/:code` | Public lookup of an unused invitation: the email it is for, or 404. The invited-user screen uses it. <!-- id:e4aEObTw --> |
| `/vault/api/admin/invitations`, `/vault/api/admin/accounts/:accountUid` | The admin API, for an [enterprise node](../operate/enterprise-node.md). A call must send the admin secret as `Authorization: Bearer <secret>`. The routes answer 404 when no secret is set. See [Running an invite-only vault](../operate/invite-only-vault.md). <!-- id:snzFGGGj --> |

# Configuration <!-- id:RdYLeQPF -->

Every setting is a flag with an environment variable behind it. <!-- id:r5otBYl0 -->

<!-- id:dpwi-9OX -->
| Flag <!-- col:nqd9mgsJ --> | Variable <!-- col:1hyrhRBI --> | Default <!-- col:GiUpHUxP --> <!-- id:XgD3dClc --> |
| --- | --- | --- |
| `--server-port` | `SEED_VAULT_HTTP_PORT` | 3000 (3030 in development) <!-- id:KGshT5r_ --> |
| `--server-hostname` | `SEED_VAULT_HTTP_HOSTNAME` | `0.0.0.0` <!-- id:DXlfrAxt --> |
| `--rp-id`, `--rp-origin` | `SEED_VAULT_RP_ID`, `SEED_VAULT_RP_ORIGIN` | required; the WebAuthn relying party, `hyper.media` in production <!-- id:MIYCiA6k --> |
| `--rp-name` | `SEED_VAULT_RP_NAME` | `Seed Hypermedia Identity Vault`; the name people see on the passkey prompt and on the invitation screen |
| `--db-path` | `SEED_VAULT_DB_PATH` | `./data/vault.sqlite`, `/data/vault.sqlite` in the image <!-- id:VhY74adO --> |
| `--backend-http-base-url` | `SEED_VAULT_BACKEND_HTTP_BASE_URL` | the relying-party origin <!-- id:O1Bmd2rW --> |
| `--backend-grpc-base-url` | `SEED_VAULT_BACKEND_GRPC_BASE_URL` | the backend HTTP URL <!-- id:wc1QXIWQ --> |
| `--web-base-url` | `SEED_VAULT_WEB_BASE_URL` | same origin <!-- id:YyzzqcLE --> |
| `--smtp-*` | `SEED_VAULT_SMTP_*` | unset, which disables email <!-- id:vGM4RTQy --> |
| `--email-relay-url`, `--email-relay-token` | `SEED_VAULT_EMAIL_RELAY_URL`, `SEED_VAULT_EMAIL_RELAY_TOKEN` | unset; when set, the vault sends verification emails through the Seed hosting email relay. Each email is one `POST <url>` with `Authorization: Bearer <token>` and a JSON body `{to, subject, text, html?, replyTo?}`. Any 2xx answer means the relay took it. Anything else fails the send. The relay wins over SMTP and sets the sender itself. An [enterprise node](../operate/enterprise-node.md) uses it, so it needs no SMTP account <!-- id:xjdrhPca --> |
| `--invite-only` | `SEED_VAULT_INVITE_ONLY` | off; `true` makes account creation require an invitation code. See [Running an invite-only vault](../operate/invite-only-vault.md) <!-- id:06Ks4fIt --> |
| `--admin-secret` | `SEED_VAULT_ADMIN_SECRET` | unset, which disables the admin API <!-- id:MyQ5kZPg --> |
| none | `SEED_VAULT_DEFAULT_NOTIFY_SERVER` | `https://hyper.media/hm/api/notify` when unset; set it to an empty string to run without a notify server. The sign-in callback hands sites only the notify origin. See [The notify API](../build/notify-api.md) <!-- id:Lci_Ngam --> |

The database schema has a version. Migrations are in `src/sqlite.ts` beside the schema, and they run at startup. If the version still does not match the code, the server starts in a mode that shows only a schema-mismatch page, which tells you to delete the database. <!-- id:HO_6v9PS -->

# Running it <!-- id:A0Kg0MQc -->

```sh <!-- id:F2Io5mhz -->
cd vault
bun run dev      # :3030 with hot reload, against the web app on :3000 and notify through it (:3000/hm/api/notify → :3060)
bun check        # typecheck and format
bun test
```

`./dev up` runs it as the `vault` pane. In development it proxies `/hm/api/config` to the [web app](./web.md) on port 3000. The web app finds the vault through `WEB_IDENTITY_ORIGIN` or `SEED_IDENTITY_DEFAULT_ORIGIN`. The value is `http://localhost:3030` in development and `https://hyper.media` by default. The images are `seedhypermedia/vault:dev` and `seedhypermedia/vault:latest`. On a site, the reverse proxy sends the `/vault` path to this service. <!-- id:cKbVgfWg -->

# Working with it <!-- id:69sus5M4 -->

## In the Seed app <!-- id:tem5R7L_ -->

In the [desktop app](./desktop.md), the account settings switch between the local vault and a remote one, start vault connect, and manage the email, the password and the notify server of a connected vault. Connected accounts still sign through the local daemon. <!-- id:AgHzk374 -->

## CLI <!-- id:w6gtUmyO -->

The [CLI](./cli.md) does not talk to the vault server. It reads the desktop app's local `vault.json`, and it can import an `.hmkey.json` exported from the vault. See [Keys](../build/keys.md). <!-- id:N04L1VC7 -->

## SDK <!-- id:iI516WkM -->

`@seed-hypermedia/client/hmauth`, part of the [SDK](../build/sdk.md), has the client side of delegation: `startAuth`, `handleCallback` and `createSessionSigner`. The SDK also exports the vault's cryptography helpers for other clients. <!-- id:Yfecst21 -->

## Seed API <!-- id:8gBDGaX- -->

Everything under `/vault/api` is JSON over HTTPS and belongs to the vault app. It is separate from the [Seed API](../build/web-api.md). These routes are for the vault's own frontend. Other websites use the delegation redirect that [Sign in with Seed](../build/sign-in.md) describes. <!-- id:ZcAjTycJ -->

## Agents <!-- id:8NPHnwWz -->

[Seed Agents](../agent.md) and coding agents do not sign in through the vault. An agent acts with its own key and with a capability that an account gave to it. See [Using Seed from your own agent](../build/agents.md). <!-- id:pmsCRFLK -->

# See also <!-- id:2v3pC_Ku -->

- [Sign in with Seed](../build/sign-in.md), [Keys](../build/keys.md), [Identity](../protocol/identity.md) <!-- id:odhTeckE -->
- [The web app](./web.md), [The notify service](./notify.md), [The mobile app](./mobile.md), [The desktop app](./desktop.md) <!-- id:thZZgz3X -->
- [Running an invite-only vault](../operate/invite-only-vault.md), [Enterprise node](../operate/enterprise-node.md), [Publishing a space to a domain](../operate/publishing-to-a-domain.md)
