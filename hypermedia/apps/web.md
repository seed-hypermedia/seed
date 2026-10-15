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

Server-side rendering caches the responses of `Query`, `QueryBlock`, `InteractionSummary` and `ListCitations` for 30 seconds, 500 entries at most, in [server-universal-client.ts](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/web/app/server-universal-client.ts). An entry holds the in-flight promise, so concurrent renders of one page share a single gRPC call. That client is never authenticated, so the cache only ever holds the public view. API responses to browsers carry `Cache-Control: private, no-store`, and there is no HTTP cache in front of the app. Citation lists and the counts in interaction summaries fetch one page of 500 citations and never more (`listAllPages` with `maxPages` in `@shm/shared`), because enumerating every citation of a heavily cited document held the [daemon](./daemon.md)'s read pool and took hyper.media down in August 2026. A document with more than 500 citations shows a truncated count until the daemon can report a count without enumerating. The panel that opens from a block's citation count is one page of `ListCitations` too, one entry per citing block; it does not read the activity feed, which keeps one event per publication.

# Site identity and registration <!-- id:IJs8U8LH -->

A [site](../protocol/sites.md) is a daemon plus this app plus a JSON file. `config.json` in the data directory holds `availableRegistrationSecret`, and after registration also `registeredAccountUid` and `sourcePeerId`. The owner opens `https://site/hm/register?secret=…` and pastes the link into the [desktop app](./desktop.md)'s publish dialog. The desktop app posts to `/hm/api/register`. The site then connects to the desktop's [peer](../protocol/network.md) and records the [account](../protocol/identity.md). When the site and desktop share a daemon, as in local development, matching peer IDs skip the connection and resource push because the content is already local. A `service-config.json` variant serves several sites from one deployment with custom domains. Until registration, the site shows a "not registered" page. [Sites](../protocol/sites.md) explains the model, and [Self-hosting](../build/self-hosting.md) walks through it. <!-- id:Wer3bjtI -->

Set `SEED_IS_GATEWAY=true` and the site becomes a [gateway](../protocol/sites.md). A gateway serves canonical `/hm/<account>/<path>` URLs for any account. A normal site serves one registered space. hyper.media runs as a gateway. <!-- id:Rw8CXrUL -->

## Publishing a space to a domain <!-- id:webDomainFlow -->

The first successful publication of a public space home opens an invitation to give it a web address. The owner can continue directly into Seed Hosting or reopen **Web Domain** from the home document's options menu later. The dialog stays open across navigation, including publication resumed after signing in through the vault. Private spaces, child documents, and updates to existing homes do not trigger the invitation. <!-- id:webDomainInvite -->

While viewing a space you own, open the account menu and choose **Space Settings** to update its identity, navigation, or web domain. Settings use the desktop master/detail design: a section sidebar beside the detail pane, or a section list and back navigation on small screens. Each section has its own URL under `/:settings` (or `/hm/<uid>/:settings` on a gateway). The account-menu entry is available in both desktop and mobile browsers and is hidden when viewing someone else's space. Changes use the signed-in owner's browser delegation, including when managing the space through another site's origin. <!-- id:webSpaceSettings -->

The web and desktop publishing dialogs share their domain and hosting choices, self-hosting guide, setup-URL registration flow, and publication confirmation. To self-host, follow the setup guide and paste the server’s setup URL; no Seed Hosting login is required. The browser registers the server using the current gateway peer and signs the address update with the owner’s delegation. Public servers need HTTPS when publishing from an HTTPS page; localhost HTTP remains available for development. In the browser, Seed Hosting first tries the signed email proof from Seed Vault, then falls back to a four-digit email code when needed. Choose a free Seed address after signing in. An interrupted connection can resume without reserving another address. Custom domains include DNS instructions and status checks; address changes and hosting ownership transfers appear only for sites owned by the signed-in hosting account and registered to the current space. A hosting transfer does not transfer the Seed identity. Logging out of the web app also clears its hosting credentials and attempts to revoke the hosting session. Vault sign-in carries the email proof privately in the callback fragment and stores it with the browser identity. Older browser sessions need one fresh Vault sign-in to receive the proof. Publishing signs in automatically when a proof or hosting session is available; the account footer offers **Switch account** for choosing another hosting account. Hosting accepts this proof only for new accounts from a trusted vault; existing hosting accounts still require a fresh email code. <!-- id:webDomainManage -->

Custom-domain setup opens a full-page status view at `/:settings/web-domain/<hostname>` (or `/hm/<space-uid>/:settings/web-domain/<hostname>` on a gateway). Refreshing or returning through **Space Settings → Web Domain → Open Domain Setup** restores the selected domain and resumes checking with the same hosting account. The page distinguishes DNS waiting, HTTPS setup, publication updates, and completion. The browser checks every 20 seconds while open; Seed Hosting checks DNS every minute, and propagation timing depends on the DNS provider. Completed status is verified against the owned hosting domain and the space’s published address. If browser setup state is missing, **Resume Domain Setup** reconnects to the existing owned domain without creating another one. Signing in again preserves the setup URL; a different hosting account cannot see or finish another account’s pending setup. <!-- id:webDomainProgress -->

Browser registration reads the current gateway's peer information from `/hm/api/config` and sends the registration secret directly to the hosted site's `/hm/api/register`. The destination site is selected from its Host or forwarded-host header, never the publishing browser's Origin, including when local development uses different ports. That endpoint supports cross-origin POST and OPTIONS without browser credentials; the secret still authorizes registration. The gateway is the source peer because browsers have no local daemon. Browser setup supports both managed Seed Hosting and self-hosted setup links. Deploy the updated registration endpoint before enabling the browser workflow on a gateway. <!-- id:webDomainRegister -->

# Routes <!-- id:g-s8UcQL -->

<!-- id:Snx3BrNJ -->
| Route <!-- col:ul5BNUnB --> | Purpose <!-- col:6Me_M2s5 --> <!-- id:B65JnmMP --> |
| --- | --- |
| `/<path>` and `/hm/<account>/<path>` | Server-rendered documents, with `?v=` versions, block fragments, and view terms such as `/:comments`. Append `.md` for markdown or `.json` for the document as JSON. <!-- id:XGWCl2kJ --> |
| `/api/<Key>` | The Seed API: GET queries and CBOR POST actions, dispatched over the shared typed router. See [The web API](../build/web-api.md). <!-- id:gDTmYS47 --> |
| `/hm/api/config` | Site identity: registered account, peer id, addresses, protocol id, gateway flag, notify service URL, agent server URL. <!-- id:jG1jxQE8 --> |
| `/hm/api/register`, `/hm/api/auth`, `/hm/api/delegate-device`, `/hm/api/discover`, `/hm/api/document-update`, `/hm/api/file/*`, `/hm/api/image/*`, `/hm/api/resource/*`, `/hm/api/version` | The site services. <!-- id:UffPLRjp --> |
| `/hm/api/enterprise-bootstrap` | POST only, with `Authorization: Bearer <SEED_VAULT_ADMIN_SECRET>` (404 when that variable is unset). Creates the organization's space on an Enterprise node and registers the site to it: mints a key in the daemon keystore, publishes the home document, writes `registeredAccountUid` and `sourcePeerId`, and returns the account plus its `.hmkey.json` export. 409 once the site is registered. Called by `seed-deploy` on the first enterprise deploy; see [Self-hosting](../build/self-hosting.md). |
| `/hm/register`, `/hm/create-site`, `/hm/connect`, `/hm/download`, `/hm/notifications`, `/hm/agents`, `/hm/auth/callback` | Pages of the app itself. <!-- id:Wv7DUjSg --> |
| `/hm/email-notifications?token=…` | Email notification settings, linked from every notification email. The token is the credential, so the page is open on members-only sites and sends `Referrer-Policy: no-referrer`. It talks to the notify service's `email-notif-token` endpoint: the configured notify service, or `/hm/api/notify` on the site's own origin. |

[URLs](../protocol/urls.md) explains versions, block fragments and view terms. <!-- id:1nw003En -->

# How a page is rendered

The loaders in [`app/loaders.ts`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/web/app/loaders.ts) resolve the URL to a document or comment, following [redirects](../protocol/documents.md), then fill a React Query cache that the browser takes over without refetching. Each request gets its own `QueryClient` (`app/queries.server.ts`, `staleTime: Infinity`). The query definitions are shared with the apps in `@shm/shared` (`models/queries.ts`): `queryResource`, `queryDirectory`, `queryAccount`, `queryQueryBlock`, `queryDocumentCollaborators` and the rest each return a `{queryKey, queryFn}` that works for both `prefetchQuery` on the server and `useQuery` in a component. So the rule is simple: the server prefetches exactly the queries the components will ask for.

Prefetching runs in two waves of parallel `Promise.allSettled` calls, so one failure never breaks a page: first the document, the site home, both directories, the collaborators of the document and the home, and the breadcrumb documents; then, from the document's content, the payload of every query block, every embedded document and every author account. The cache is dehydrated into the loader data and restored in a `HydrationBoundary`. Anything missing is fetched by the browser on demand. Interaction summaries (comment and citation counts) are deliberately not prefetched: computing one enumerates every citation of the target, and prefetching thirty per page took hyper.media down on 2026-08-11. The browser fetches them for the cards on screen.

The document body itself is server-rendered as real editor markup by `renderDocumentToHTML` in [`@shm/editor/ssr-render`](https://github.com/seed-hypermedia/seed/blob/main/frontend/packages/editor/src/ssr-render.tsx). It converts the blocks exactly as the editor does at mount, serializes the ProseMirror document with the schema's own `renderHTML` through `DOMSerializer` in a happy-dom window, and renders the React node views (images, embeds, query blocks) with `react-dom/server` from the same prefetched cache. The result is cached per origin, document version and data fingerprint and injected with `dangerouslySetInnerHTML`. The page keeps that placeholder until the editor has mounted over it, then `DocumentContentHandoff` in `@shm/ui` lifts it two frames later, so the swap does not paint a blank frame. Because the markup is identical, read-only and editable views share one editor instance and switch without a remount.

# Signing in the browser <!-- id:5yqQPr5T -->

Browser identities are Ed25519 keys generated with WebCrypto as non-extractable key pairs and stored in IndexedDB. A database migration dropped the older P-256 identities. A browser key does not own a space. It acts for an [account](../protocol/identity.md) held in the [vault](./vault.md), through a delegated `AGENT` [capability](../protocol/permissions.md) and a profile alias. This is the flow described in [Sign in with Seed](../build/sign-in.md). Comments and document edits are built and signed in the browser with the [SDK](../build/sdk.md) and posted through the `PublishBlobs` action. For private content the app also calls the daemon's authenticate RPC and keeps the resulting bearer token in an HTTP-only cookie. <!-- id:0ZM3UtBB -->

# Configuration <!-- id:mheSeOOI -->

<!-- id:JELVrjET -->
| Variable <!-- col:BWfEmTu7 --> | Meaning <!-- col:UmQbEoti --> <!-- id:GLgzTiYm --> |
| --- | --- |
| `DAEMON_HTTP_URL`, `DAEMON_HTTP_PORT` | The daemon's HTTP port. <!-- id:siDei7nQ --> |
| `DAEMON_FILE_URL` | Where `/ipfs` files are fetched from, defaulting to the daemon. <!-- id:tR9GjEme --> |
| `SEED_BASE_URL` | The site's public origin. <!-- id:VqskbSlA --> |
| `SEED_HOST_URL` | Hosting API origin, injected into the browser at runtime. Defaults to `https://host.seed.hyper.media` in production and local hosting during development; set it explicitly for staging. `VITE_SEED_HOST_URL` is a fallback. <!-- id:webHostOrigin --> |
| `SEED_IS_GATEWAY` | Gateway mode. <!-- id:2qTla-90 --> |
| `SEED_SIGNING_ENABLED`, `SEED_IDENTITY_ENABLED`, `SEED_IDENTITY_DEFAULT_ORIGIN` | Web signing and the vault origin used for sign-in. <!-- id:GbCyB_Df --> |
| `DATA_DIR` | Where `config.json` lives. <!-- id:Yog9fhT0 --> |
| `SERVICE_ADMIN_SECRET` | Admin secret for the multi-site service mode. <!-- id:7hphqAYs --> |
| `NOTIFY_SERVICE_HOST` (`VITE_NOTIFY_SERVICE_HOST` at build time) | The [notify](./notify.md) service to use: canonically `https://<site>/hm/api/notify`. An origin-only value still works and uses the legacy `/hm/api/<endpoint>` paths; the retired `notify.seed.hyper.media` and `notify-dev.seed.hyper.media` are rewritten to `https://hyper.media/hm/api/notify` and `https://dev.hyper.media/hm/api/notify`. <!-- id:qjnnUf-X --> |

The `/hm/notifications` page signs its requests in the browser with the session key and talks to the notify service that the vault callback named at sign-in, not to `NOTIFY_SERVICE_HOST`. Every client builds notify URLs with `notifyEndpointUrl` from `@shm/shared/notify-url`, which handles canonical, legacy and retired values alike. [Notify](./notify.md) describes both the signed inbox and the older unsigned email subscribe form.

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
