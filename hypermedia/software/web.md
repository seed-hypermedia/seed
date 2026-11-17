---
name: The Seed web app
summary: The Seed web app is the server that turns a daemon into a website, and it serves rendered pages, the Seed API, the site services under /hm/api, and sign-in for browsers.
---
The Seed web app is the server that turns a [daemon](./daemon.md) into a website. It sits in front of a daemon and serves a [space](../protocol/spaces.md) at a domain. That is a [site](../protocol/sites.md). Anyone with a browser can read it, and this documentation is served by it. hyper.media, every `*.hyper.media` site and every self-hosted site run it. <!-- id:FE6ek0Si -->

The web app serves four things:

- A page for every [document](../protocol/documents.md), rendered on the server.
- The typed [Seed API](../build/web-api.md), for programs.
- The [site services](../build/site-services.md) under `/hm/api`. They let a [desktop app](./desktop.md) register the site, and they let browsers [sign in](../build/sign-in.md).
- A small editor, so people can [comment](../protocol/comments.md) and edit from the web with a real signature.

# Where the code is <!-- id:7q8AIncq -->

The code is in `frontend/apps/web`, package `@shm/web`. It is built with Remix on Node, Vite, React Query, the shared editor, Sentry and Tailwind. <!-- id:KzU8-LJ- -->

- `app/entry.server.tsx` is the server entry. It loads `.env` first, then everything else.
- `app/routes/$.tsx` is the catch-all route that renders documents.
- `app/routes/api.$.tsx` is the Seed API.
- The `app/routes/hm.api.*` files are the site services.

# How it talks to the daemon <!-- id:UrWVV-FO -->

The server holds one gRPC-web client to `DAEMON_HTTP_URL`, the daemon's HTTP port. The loaders that render pages and the API both use this client. <!-- id:eZhkSdod -->

When a request carries a [bearer token](../protocol/privacy.md), the client adds `Authorization: Bearer <token>` to its call. So a signed-in browser can read the [private content](../protocol/privacy.md) it is allowed to see. The API also passes the browser's own authorization header into every gRPC call it makes.

If the daemon rejects a bearer token, the request fails with a 401, even for public content. The page loader shows that as a server error. If a site refuses to load after a key change, clear the cookie. <!-- id:Ka-txL8V -->

**Caching.** When the server renders a page, it caches the answers of `Query`, `QueryBlock`, `InteractionSummary` and `ListCitations` for 30 seconds, 500 entries at most. The code is in [server-universal-client.ts](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/web/app/server-universal-client.ts). <!-- id:WMBvh_Nn -->

- An entry holds the promise of a call that is still running. So when the server renders one page several times at once, the renders share one gRPC call.
- That client never sends a token, so the cache only ever holds the public view.
- API answers to browsers carry `Cache-Control: private, no-store`, and there is no HTTP cache in front of the app.

**Citations.** A list of [citations](../protocol/links-and-citations.md), and the counts in an interaction summary, fetch one page of 500 citations and never more (`listAllPages` with `maxPages` in `@shm/shared`). Reading every citation of a document with very many citations would keep the daemon's [read pool](../operate/daemon-operations.md) busy. So a document with more than 500 citations shows a cut count. The panel that opens from the citation count of a [block](../protocol/blocks.md) is also one page of `ListCitations`, with one entry for each citing block. It does not read the activity feed, which keeps one event for each publication.

# Site identity and registration <!-- id:IJs8U8LH -->

A site is a daemon, this app and a JSON file. The file is `config.json` in the data directory. It holds `availableRegistrationSecret`, and after registration also `registeredAccountUid` and `sourcePeerId`. Until a site is registered, it shows a "not registered" page. Registration goes like this: <!-- id:Wer3bjtI -->

1. The owner opens `https://site/hm/register?secret=…` and pastes the link into the publish dialog of the [desktop app](./desktop.md).
2. The desktop app posts to `/hm/api/register`.
3. The site connects to the desktop app's [peer](../protocol/network.md) and records the [account](../protocol/identity.md).

When the site and the desktop app share a daemon, as in local development, the peer ids match. Then the site skips the connection and the push of content, because the content is already there. A second file format, `service-config.json`, serves several sites with custom domains from one deployment. [Sites](../protocol/sites.md) explains the model, and [Self-hosting](../operate/self-hosting.md) gives the steps.

Set `SEED_IS_GATEWAY=true` and the site becomes a [gateway](../protocol/sites.md). A gateway serves `/hm/<account>/<path>` URLs for any account. A normal site serves one registered space. hyper.media runs as a gateway. <!-- id:Rw8CXrUL -->

An owner can register a site from the desktop app or from a browser, or let Seed Hosting run the site. [Publishing a space to a domain](../operate/publishing-to-a-domain.md) describes that flow, which the web app shares with the desktop app.

# Space settings in the browser

The owner of a space can change its settings in a browser. While you view a space you own, open the account menu, or the options menu on the space's [home document](../protocol/spaces.md), and choose **Space Settings**. There you change the general settings, the identity, the navigation and the web domain. <!-- id:webSpaceSettings -->

- The settings look like the ones in the desktop app: a list of sections beside the detail pane, or a section list with back navigation on a small screen.
- Each section has its own URL under `/:settings`, or `/hm/<uid>/:settings` on a gateway.
- The entry in the account menu shows in desktop and mobile browsers. It is hidden when you view someone else's space.
- A change is signed with the session key of the signed-in owner. This also works when the owner manages the space through the origin of another site.

On any page of a space, its owner can add a link to the top bar without opening the settings:

- **Add or edit links** shows after the links while the pointer is over them. On a touch screen it always shows. In the phone menu it is below the links.
- The new link goes at the end, and the app publishes it at once. The bar holds up to six links. When the bar is full, the dialog only offers **Manage links**.
- **Manage links**, in the same dialog, opens the Navigation settings. There you edit, reorder and remove links.

# Routes <!-- id:g-s8UcQL -->

<!-- id:Snx3BrNJ -->
| Route <!-- col:ul5BNUnB --> | Purpose <!-- col:6Me_M2s5 --> <!-- id:B65JnmMP --> |
| --- | --- |
| `/<path>` and `/hm/<account>/<path>` | Documents, rendered on the server, with `?v=` versions, block fragments, and view terms such as `/:comments`. Add `.md` for markdown or `.json` for the document as JSON. <!-- id:XGWCl2kJ --> |
| `/api/<Key>` | The Seed API: GET queries and CBOR POST actions, handled by the shared typed router. See [Seed API](../build/web-api.md). <!-- id:gDTmYS47 --> |
| `/hm/api/config` | The identity of the site: registered account, peer id, addresses, protocol id, gateway flag, the URL of the [notify service](./notify.md) and the URL of the [app environment](./app-environment.md). <!-- id:jG1jxQE8 --> |
| `/hm/api/register`, `/hm/api/auth`, `/hm/api/delegate-device`, `/hm/api/discover`, `/hm/api/document-update`, `/hm/api/file/*`, `/hm/api/image/*`, `/hm/api/resource/*`, `/hm/api/version` | The site services. <!-- id:UffPLRjp --> |
| `/hm/api/enterprise-bootstrap` | POST only, with `Authorization: Bearer <SEED_VAULT_ADMIN_SECRET>`. It answers 404 when that variable is unset. It creates the organization's space on an [enterprise node](../operate/enterprise-node.md) and registers the site to it. To do that it makes a key in the daemon's keystore, publishes the home document, writes `registeredAccountUid` and `sourcePeerId`, and returns the account with its `.hmkey.json` export. It answers 409 once the site is registered. `seed-deploy` calls it on the first enterprise deploy. <!-- id:liDi5jpH --> |
| `/hm/api/enterprise-site-url` | POST only, with the same secret. After the hostname of an enterprise node changes, it publishes the organization's home document again with the new site address. |
| `/hm/api/session`, `/hm/sign-in` | The sign-in check and the sign-in page of a members-only site. |
| `/hm/register`, `/hm/create-site`, `/hm/connect`, `/hm/download`, `/hm/notifications`, `/hm/agents/*`, `/hm/auth/callback` | Pages of the app itself. <!-- id:Wv7DUjSg --> |
| `/hm/email-notifications?token=…` | The email notification settings. Every notification email links to it. The token in the link is the credential. So the page is open on a members-only site, and it sends `Referrer-Policy: no-referrer`. It calls the `email-notif-token` route of the notify service: the configured service, or `/hm/api/notify` on the site's own origin. <!-- id:L_ukd8Oz --> |

[URLs](../protocol/urls.md) explains versions, block fragments and view terms. <!-- id:1nw003En -->

# How a page is rendered <!-- id:zCWAa1Bw -->

The server loads the data a page needs, and the browser takes it over without asking again. The rule is simple: the server loads exactly the queries that the components will ask for. <!-- id:ssASr67J -->

- The loaders in [`app/loaders.ts`](https://github.com/seed-hypermedia/seed/blob/main/frontend/apps/web/app/loaders.ts) find the document or comment for the URL. They follow [redirects](../protocol/documents.md).
- Then they fill a React Query cache. Each request gets its own `QueryClient` (`app/queries.server.ts`, `staleTime: Infinity`).
- The apps share the query definitions, in `@shm/shared` (`models/queries.ts`). `queryResource`, `queryDirectory`, `queryAccount`, `queryQueryBlock`, `queryDocumentCollaborators` and the others each return a `{queryKey, queryFn}`. The same object works for `prefetchQuery` on the server and for `useQuery` in a component.

The server loads in two rounds. Each round is a set of parallel `Promise.allSettled` calls, so one failure never breaks a page. <!-- id:Zl-rdHhU -->

1. The document, the home document of the site, both directories, the collaborators of the document and of the home, and the documents in the breadcrumb.
2. From the content of the document: the data of every [query block](../block/query.md), every embedded document and the account of every author.

The server puts the cache into the loader data, and the page restores it in a `HydrationBoundary`. The browser fetches anything that is missing when it needs it. The server does not load interaction summaries (the counts of comments and citations) on purpose. To compute one, the daemon reads the citations of the target, and a page can show thirty cards. The browser fetches the summaries for the cards on screen.

`renderDocumentToHTML` in `@shm/editor` renders the body of the document on the server, as the same HTML the editor produces, from the same cache. The editor then starts on top of it, and the reader never sees an empty frame. [The shared packages](./packages.md) describes that renderer and the handoff.

# Signing in the browser <!-- id:5yqQPr5T -->

A browser identity is an Ed25519 key pair. WebCrypto makes it in a form that cannot be exported, and the browser stores it in IndexedDB. This key is the [session key](../build/sign-in.md). <!-- id:0ZM3UtBB -->

- A browser key does not own a space. It acts for an account that the [vault](./vault.md) holds. The account gives it an `AGENT` [capability](../protocol/permissions.md), and the key's [profile](../profile.md) is an alias of the account. [Sign in with Seed](../build/sign-in.md) describes this flow.
- The browser builds and signs comments and document edits with the [SDK](../build/sdk.md), and posts them through the `PublishBlobs` action.
- For private content the app also calls the daemon's authenticate call. It keeps the bearer token it gets in an HTTP-only cookie.

# Configuration <!-- id:mheSeOOI -->

<!-- id:JELVrjET -->
| Variable <!-- col:BWfEmTu7 --> | Meaning <!-- col:UmQbEoti --> <!-- id:GLgzTiYm --> |
| --- | --- |
| `DAEMON_HTTP_URL`, `DAEMON_HTTP_PORT` | The daemon's HTTP port. <!-- id:siDei7nQ --> |
| `DAEMON_FILE_URL` | Where `/ipfs` files are fetched from, defaulting to the daemon. <!-- id:tR9GjEme --> |
| `SEED_BASE_URL` | The site's public origin. <!-- id:VqskbSlA --> |
| `SEED_HOST_URL` | The origin of the hosting API. The server gives it to the browser at runtime. The default is `https://host.seed.hyper.media` in production and the local hosting service in development. Set it yourself for staging. `VITE_SEED_HOST_URL` is used when it is unset. <!-- id:webHostOrigin --> |
| `SEED_IS_GATEWAY` | Gateway mode. <!-- id:2qTla-90 --> |
| `SEED_SIGNING_ENABLED`, `SEED_IDENTITY_ENABLED`, `SEED_IDENTITY_DEFAULT_ORIGIN` | Web signing and the vault origin used for sign-in. <!-- id:GbCyB_Df --> |
| `DATA_DIR` | Where `config.json` lives. <!-- id:Yog9fhT0 --> |
| `SERVICE_ADMIN_SECRET` | Admin secret for the multi-site service mode. <!-- id:7hphqAYs --> |
| `NOTIFY_SERVICE_HOST` (`VITE_NOTIFY_SERVICE_HOST` at build time) | The [notify](./notify.md) service to use, normally `https://<site>/hm/api/notify`. The site reports it in `/hm/api/config`. <!-- id:qjnnUf-X --> |
| `SEED_AGENT_SERVER_URL` | The app environment this site offers. The site reports it as `appEnvironmentUrl` in `/hm/api/config`, and as `agentServerUrl`, the older name. |
| `SEED_REQUIRE_SIGN_IN` | Members only: every page needs a signed-in member. See the [enterprise node](../operate/enterprise-node.md). |
| `SEED_UPSTREAM_API_URL` | A public node, such as `https://hyper.media`. The site asks it for documents of spaces that its own daemon does not hold. An enterprise node uses it. |

The `/hm/notifications` page signs its requests in the browser with the session key. It talks to the notify service that the vault named at sign-in, and not to `NOTIFY_SERVICE_HOST`. [The notify API](../build/notify-api.md) explains how every client finds its notify service. [Notify](./notify.md) describes the signed inbox and the older unsigned email form. <!-- id:hOOFd3e2 -->

# Running it

```sh
pnpm web              # on :3000, against the daemon of the desktop development app
pnpm web:standalone   # on :3099, with its own daemon
```

`./dev up` runs it on port 3000 beside the other services. [Self-hosting](../operate/self-hosting.md) covers the container a site runs.

# Working with it <!-- id:pl0RnALo -->

## In the Seed app

The [desktop app](./desktop.md) serves the same typed `/api/<Key>` routes from the same code on its local API bridge. It registers a space with a site through `/hm/api/register`.

## CLI <!-- id:6C8mZBl9 -->

The [CLI](./cli.md) reads and writes through a site's `/api`. It uses hyper.media unless `--server` names another site. When you give it an `https://` URL, it uses the site in that URL. <!-- id:Hy2tSMSG -->

## SDK <!-- id:GVjy1QLE -->

`createSeedClient('https://site')` talks to `/api/<Key>`. See [The SDK](../build/sdk.md). <!-- id:4Ino3csp -->

## Seed API <!-- id:O60MsKQn -->

[Seed API](../build/web-api.md) documents everything under `/api`, and [Site services](../build/site-services.md) documents `/hm/api`. <!-- id:2jqaT5BG -->

## Agents <!-- id:cqdH0x5Y -->

[Seed Agents](../agent.md) read and write Hypermedia through a site's `/api`, hyper.media by default. They read the site's `/hm/api/config` to learn which account the site publishes. <!-- id:2veGCxtK -->

# See also <!-- id:IH4awEuK -->

- [Sites](../protocol/sites.md), [Seed API](../build/web-api.md), [Self-hosting](../operate/self-hosting.md), [Sign in with Seed](../build/sign-in.md) <!-- id:zYR_zogz -->
- [The daemon](./daemon.md), [The vault](./vault.md), [Notify](./notify.md), [The Explorer](./explorer.md), [The shared packages](./packages.md) <!-- id:msVW3FYN -->
- [Publishing a space to a domain](../operate/publishing-to-a-domain.md), [Enterprise node](../operate/enterprise-node.md), [Daemon operations](../operate/daemon-operations.md)
