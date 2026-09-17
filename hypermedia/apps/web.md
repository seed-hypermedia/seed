---
name: The Seed web app
summary: The server that turns a daemon into a website and a gateway, serving rendered pages, the Seed API, the site services under /hm/api, and signing in the browser.
---
The Seed web app is what you are reading right now. It sits in front of a daemon and serves a space at a domain: server-rendered pages for every document, the typed Seed API for programs, the site services that let a desktop app register the site and let browsers sign in, and a small editor so people can comment from the web with a real signature. hyper.media, every `*.hyper.media` site, and every self-hosted site run it.

# Where the code is

`frontend/apps/web`, package `@shm/web`: Remix 2.17 on Node with Vite, React Query, the shared editor, Sentry, Tailwind. The server entry is `app/entry.server.tsx`, which loads `.env` first, then everything else. The catch-all route `app/routes/$.tsx` renders documents; `app/routes/api.$.tsx` is the Seed API; the `app/routes/hm.api.*` files are the site services. Run it with `pnpm web` against the desktop dev daemon, or `pnpm web:standalone` with its own daemon.

# How it talks to the daemon

The server holds one gRPC-web client to `DAEMON_HTTP_URL`, the daemon's HTTP port. An interceptor adds `Authorization: Bearer <token>` when the current request carries one, so a signed-in browser can read private content it is allowed to see. Server-rendered loaders and the API both go through this client; the API additionally forwards the browser's own authorization header into every gRPC call it makes.

One quirk to know: a bearer token the daemon rejects fails the request with a 401 even for public content, which the page loader surfaces as a server error. Clear the cookie if a site refuses to load after a key change.

# Site identity and registration

A site is a daemon plus this app plus a JSON file. `config.json` in the data directory holds `availableRegistrationSecret`, and after registration `registeredAccountUid` and `sourcePeerId`. The owner opens `https://site/hm/register?secret=…`, pastes the link into the desktop app's publish dialog, and the desktop posts to `/hm/api/register`; the site connects to the desktop's peer and records the account. A `service-config.json` variant serves several sites from one deployment with custom domains. Until registered, the site shows a "not registered" page. [Sites](../protocol/sites.md) explains the model; [Self-hosting](../build/self-hosting.md) walks through it.

Set `SEED_IS_GATEWAY=true` and the site becomes a gateway: it serves canonical `/hm/<account>/<path>` URLs for any account rather than one registered space. hyper.media runs this way.

# Routes

| Route | Purpose |
| --- | --- |
| `/<path>` and `/hm/<account>/<path>` | Server-rendered documents, with `?v=` versions, block fragments, and view terms such as `/:comments`. Append `.md` for markdown or `.json` for the document as JSON. |
| `/api/<Key>` | The Seed API: GET queries and CBOR POST actions, dispatched over the shared typed router. See [The web API](../build/web-api.md). |
| `/hm/api/config` | Site identity: registered account, peer id, addresses, protocol id, gateway flag, notification host. |
| `/hm/api/register`, `/hm/api/auth`, `/hm/api/delegate-device`, `/hm/api/discover`, `/hm/api/document-update`, `/hm/api/file/*`, `/hm/api/image/*`, `/hm/api/resource/*`, `/hm/api/version` | The site services. |
| `/hm/register`, `/hm/create-site`, `/hm/connect`, `/hm/download`, `/hm/notifications`, `/hm/agents`, `/hm/auth/callback` | Pages of the app itself. |

# Signing in the browser

Browser identities are Ed25519 keys generated with WebCrypto as non-extractable key pairs and stored in IndexedDB. Older P-256 identities were dropped in a database migration. A browser key does not own a space; it acts on behalf of an account held in the [vault](./vault.md) through a delegated agent capability and a profile alias, which is the "Sign in with Seed" flow described in [Sign in with Seed](../build/sign-in.md). Comments and document edits are built and signed client-side with the SDK and posted through the `PublishBlobs` action. For private content the app also calls the daemon's authenticate RPC and keeps the resulting bearer token in an HTTP-only cookie.

# Configuration

| Variable | Meaning |
| --- | --- |
| `DAEMON_HTTP_URL`, `DAEMON_HTTP_PORT` | The daemon's HTTP port. |
| `DAEMON_FILE_URL` | Where `/ipfs` files are fetched from, defaulting to the daemon. |
| `SEED_BASE_URL` | The site's public origin. |
| `SEED_IS_GATEWAY` | Gateway mode. |
| `SEED_SIGNING_ENABLED`, `SEED_IDENTITY_ENABLED`, `SEED_IDENTITY_DEFAULT_ORIGIN` | Web signing and the vault origin used for sign-in. |
| `DATA_DIR` | Where `config.json` lives. |
| `SERVICE_ADMIN_SECRET` | Admin secret for the multi-site service mode. |
| `VITE_NOTIFY_SERVICE_HOST` | The [notify](./notify.md) service to use. |

# Working with it

## CLI

`seed-cli` reads and writes through a site's `/api` by default, hyper.media unless `--server` says otherwise, and an `https://` URL argument targets that site directly.

## SDK

`createSeedClient('https://site')` talks to `/api/<Key>`; [The SDK](../build/sdk.md).

## Web API

Everything under `/api` and `/hm/api` is documented in [The web API](../build/web-api.md).

## Agents

Seed Agents use a site's `/api` as their Hypermedia backend, hyper.media by default, and the site's `/hm/api/config` to learn which account it publishes.

# See also

- [Sites](../protocol/sites.md), [The web API](../build/web-api.md), [Self-hosting](../build/self-hosting.md)
- [The vault](./vault.md), [Notify](./notify.md), [The Explorer](./explorer.md)
