---
name: The Seed web app
summary: The server that turns a daemon into a website and a gateway, serving rendered pages, the Seed API, the site services under /hm/api, and signing in the browser.
---
The Seed web app is what you are reading right now. It sits in front of a [daemon](./daemon.md) and serves a space at a domain as a [site](../protocol/sites.md). It serves server-rendered pages for every [document](../protocol/documents.md), the typed [Seed API](../build/web-api.md) for programs, and the site services that let a [desktop app](./desktop.md) register the site and let browsers [sign in](../build/sign-in.md). It also has a small editor, so people can [comment](../protocol/comments.md) from the web with a real signature. hyper.media, every `*.hyper.media` site, and every self-hosted site run it. <!-- id:FE6ek0Si -->

# Where the code is <!-- id:7q8AIncq -->

`frontend/apps/web`, package `@shm/web`: Remix 2.17 on Node with Vite, React Query, the shared editor, Sentry, Tailwind. The server entry is `app/entry.server.tsx`, which loads `.env` first, then everything else. The catch-all route `app/routes/$.tsx` renders documents. `app/routes/api.$.tsx` is the Seed API. The `app/routes/hm.api.*` files are the site services. Run it with `pnpm web` against the desktop dev daemon, or `pnpm web:standalone` with its own daemon. <!-- id:KzU8-LJ- -->

# How it talks to the daemon <!-- id:UrWVV-FO -->

The server holds one gRPC-web client to `DAEMON_HTTP_URL`, the [daemon](./daemon.md)'s HTTP port. An interceptor adds `Authorization: Bearer <token>` when the current request carries one, so a signed-in browser can read [private content](../protocol/privacy.md) it is allowed to see. Server-rendered loaders and the API both go through this client. The API also forwards the browser's own authorization header into every gRPC call it makes. <!-- id:eZhkSdod -->

A bearer token the daemon rejects fails the request with a 401, even for public content. The page loader shows that as a server error. Clear the cookie if a site refuses to load after a key change. <!-- id:Ka-txL8V -->

# Site identity and registration <!-- id:IJs8U8LH -->

A [site](../protocol/sites.md) is a daemon plus this app plus a JSON file. `config.json` in the data directory holds `availableRegistrationSecret`, and after registration also `registeredAccountUid` and `sourcePeerId`. The owner opens `https://site/hm/register?secret=…` and pastes the link into the [desktop app](./desktop.md)'s publish dialog. The desktop app posts to `/hm/api/register`. The site then connects to the desktop's [peer](../protocol/network.md) and records the [account](../protocol/identity.md). A `service-config.json` variant serves several sites from one deployment with custom domains. Until registration, the site shows a "not registered" page. [Sites](../protocol/sites.md) explains the model, and [Self-hosting](../build/self-hosting.md) walks through it. <!-- id:Wer3bjtI -->

Set `SEED_IS_GATEWAY=true` and the site becomes a [gateway](../protocol/sites.md). A gateway serves canonical `/hm/<account>/<path>` URLs for any account. A normal site serves one registered space. hyper.media runs as a gateway. <!-- id:Rw8CXrUL -->

# Routes <!-- id:g-s8UcQL -->

<!-- id:Snx3BrNJ -->
| Route <!-- col:ul5BNUnB --> | Purpose <!-- col:6Me_M2s5 --> <!-- id:B65JnmMP --> |
| --- | --- |
| `/<path>` and `/hm/<account>/<path>` | Server-rendered documents, with `?v=` versions, block fragments, and view terms such as `/:comments`. Append `.md` for markdown or `.json` for the document as JSON. <!-- id:XGWCl2kJ --> |
| `/api/<Key>` | The Seed API: GET queries and CBOR POST actions, dispatched over the shared typed router. See [The web API](../build/web-api.md). <!-- id:gDTmYS47 --> |
| `/hm/api/config` | Site identity: registered account, peer id, addresses, protocol id, gateway flag, notification host. <!-- id:jG1jxQE8 --> |
| `/hm/api/register`, `/hm/api/auth`, `/hm/api/delegate-device`, `/hm/api/discover`, `/hm/api/document-update`, `/hm/api/file/*`, `/hm/api/image/*`, `/hm/api/resource/*`, `/hm/api/version` | The site services. <!-- id:UffPLRjp --> |
| `/hm/register`, `/hm/create-site`, `/hm/connect`, `/hm/download`, `/hm/notifications`, `/hm/agents`, `/hm/auth/callback` | Pages of the app itself. <!-- id:Wv7DUjSg --> |

[URLs](../protocol/urls.md) explains versions, block fragments and view terms. <!-- id:1nw003En -->

# Signing in the browser <!-- id:5yqQPr5T -->

Browser identities are Ed25519 keys generated with WebCrypto as non-extractable key pairs and stored in IndexedDB. A database migration dropped the older P-256 identities. A browser key does not own a space. It acts for an [account](../protocol/identity.md) held in the [vault](./vault.md), through a delegated `AGENT` [capability](../protocol/permissions.md) and a profile alias. This is the flow described in [Sign in with Seed](../build/sign-in.md). Comments and document edits are built and signed in the browser with the [SDK](../build/sdk.md) and posted through the `PublishBlobs` action. For private content the app also calls the daemon's authenticate RPC and keeps the resulting bearer token in an HTTP-only cookie. <!-- id:0ZM3UtBB -->

# Configuration <!-- id:mheSeOOI -->

<!-- id:JELVrjET -->
| Variable <!-- col:BWfEmTu7 --> | Meaning <!-- col:UmQbEoti --> <!-- id:GLgzTiYm --> |
| --- | --- |
| `DAEMON_HTTP_URL`, `DAEMON_HTTP_PORT` | The daemon's HTTP port. <!-- id:siDei7nQ --> |
| `DAEMON_FILE_URL` | Where `/ipfs` files are fetched from, defaulting to the daemon. <!-- id:tR9GjEme --> |
| `SEED_BASE_URL` | The site's public origin. <!-- id:VqskbSlA --> |
| `SEED_IS_GATEWAY` | Gateway mode. <!-- id:2qTla-90 --> |
| `SEED_SIGNING_ENABLED`, `SEED_IDENTITY_ENABLED`, `SEED_IDENTITY_DEFAULT_ORIGIN` | Web signing and the vault origin used for sign-in. <!-- id:GbCyB_Df --> |
| `DATA_DIR` | Where `config.json` lives. <!-- id:Yog9fhT0 --> |
| `SERVICE_ADMIN_SECRET` | Admin secret for the multi-site service mode. <!-- id:7hphqAYs --> |
| `VITE_NOTIFY_SERVICE_HOST` | The [notify](./notify.md) service to use. <!-- id:qjnnUf-X --> |

# Working with it <!-- id:pl0RnALo -->

## CLI <!-- id:6C8mZBl9 -->

The [CLI](./cli.md) reads and writes through a site's `/api`. It uses hyper.media unless `--server` names another site, and an `https://` URL argument targets that site directly. <!-- id:Hy2tSMSG -->

## SDK <!-- id:GVjy1QLE -->

`createSeedClient('https://site')` talks to `/api/<Key>`. See [The SDK](../build/sdk.md). <!-- id:4Ino3csp -->

## Web API <!-- id:O60MsKQn -->

[The web API](../build/web-api.md) documents everything under `/api` and `/hm/api`. <!-- id:2jqaT5BG -->

## Agents <!-- id:cqdH0x5Y -->

[Seed Agents](../agent.md) use a site's `/api` as their Hypermedia backend, hyper.media by default. They read the site's `/hm/api/config` to learn which account it publishes. <!-- id:2veGCxtK -->

# See also <!-- id:IH4awEuK -->

- [Sites](../protocol/sites.md), [The web API](../build/web-api.md), [Self-hosting](../build/self-hosting.md), [Sign in with Seed](../build/sign-in.md) <!-- id:zYR_zogz -->
- [The daemon](./daemon.md), [The vault](./vault.md), [Notify](./notify.md), [The Explorer](./explorer.md) <!-- id:msVW3FYN -->
