---
name: Sites
summary: A site is a space published at a web domain by a server that holds the space's content, answers for it on the network, and renders it as ordinary web pages.
---
A **site** is a [space](./identity.md) (an account's namespace of [documents](./documents.md)) published at a web domain. Anyone with a browser can read it at `https://example.com/about`. Anyone with a Seed node can reach the same content as [`hm://<account>/about`](./urls.md). The site's server is a normal Seed node running on a server, plus a web app in front of it. <!-- id:DFpPyir5 -->

Sites connect the peer-to-peer [network](./network.md) to the web. They give a space a stable place on the internet, a server that is always online to answer for it, and a way to reach readers who have never installed anything. <!-- id:9u1VzQZ1 -->

# What a site is made of <!-- id:BmzKnjvt -->

A site deployment runs three containers behind one domain: <!-- id:0jgAgYs3 -->

<!-- id:h75-fJJo -->
| Piece <!-- col:e96NCUpH --> | What it does <!-- col:Q-ZuR1y0 --> <!-- id:1QXbhd-7 --> |
| --- | --- |
| **the [Seed daemon](../apps/daemon.md)** (`seedhypermedia/site` image) | the libp2p peer that stores and serves the space's blobs; runs with `-p2p.no-relay=true -p2p.force-reachability-public=true`, announces `/dns4/<host>/tcp/56000` and `/dns4/<host>/udp/56000/quic-v1`, keeps its keys in a file keystore <!-- id:iMEv5biE --> |
| **the [Seed web app](../apps/web.md)** (`seedhypermedia/web` image) | a server-rendered web app that talks to the daemon over gRPC-web, renders documents as HTML, exposes the [Seed API](../build/web-api.md) at `/api/<Key>` and the site services at `/hm/api/*`, and owns the registration state <!-- id:RhYvvilr --> |
| **a reverse proxy** (Caddy) | terminates HTTPS for the domain, sends `/ipfs/*` straight to the daemon and everything else to the web app <!-- id:M1KwQU3S --> |

An optional [notify service](../apps/notify.md) sends email notifications for the site. The [self-hosting guide](../build/self-hosting.md) walks through running this stack. This page explains what it means at the protocol level. <!-- id:gnCGtIMr -->

The daemon has no "site mode" and no site-registration RPC. It does not know it is a site. Two facts that other nodes observe make it one: its web app advertises a registered account at `/hm/api/config`, and the space's home document names the site's URL. <!-- id:EkMy1d8X -->

# The home document and `siteUrl` <!-- id:Xw4m9P2- -->

Every space has a home document at the empty path. `hm://<account>` is its URL, and its `name` and `icon` become the site's title and favicon. When a space is registered with a site, the Seed app writes the site's origin into the home document's [metadata](../metadata.md) as `siteUrl` (for example `https://example.com`). <!-- id:C8gsd858 -->

That one attribute does a lot. Every node that reads the home document learns where the space lives on the web. The daemon resolves the space's **site peer** by fetching `https://<siteUrl>/hm/api/config`. It treats that peer as the authority tier in [discovery](./network.md). It authenticates to that peer when it holds a [writer](./permissions.md) key for the space, includes [private](./privacy.md) blobs in pushes to it, and lets that peer read the space's private content. A reader's app also uses the URL to offer "open on the web", and the web app uses it to build pretty links. So whoever controls the HTTPS endpoint named in `siteUrl` holds real trust; see [Integrity](./integrity.md). <!-- id:PxABJFy5 -->

# Registration <!-- id:TyVck7XM -->

Registering binds one account to one site. It is a short handshake between the site's web app and the [Seed app](../apps/desktop.md) that holds the [account](./identity.md) key: <!-- id:M5k-KNiO -->
  1. The site's operator (or the hosting service on their behalf) puts a one-time secret into the site's configuration. The setup link looks like `https://example.com/hm/register?secret=…`. <!-- id:z7tmjsEM -->
  2. The account owner opens "Publish Site" in the Seed app and pastes that link. The app fetches `/hm/api/config` and refuses if the site is already registered to a different account. <!-- id:UwGKR5Nl -->
  3. The app posts `{registrationSecret, accountUid, peerId, addrs}` to `POST /hm/api/register`. The web app checks the secret, tells its daemon to connect to the app's peer, stores `registeredAccountUid` in its config, and subscribes its daemon recursively to the account's whole space so it stays current from then on. <!-- id:XWHdTS1E -->
  4. The app connects to the site's peer and pushes the space's home document, with its related material, to it with `PushResourcesToPeer`. The rest of the space arrives through the site's recursive subscription. <!-- id:0KAP3DFV -->
  5. The app publishes a new version of the home document with `siteUrl` set to the site's origin. <!-- id:eZstjI_3 -->

From that moment `/hm/api/config` advertises the account, the site's pages render that account's home document, and other nodes treat the site's peer as the authority for the space. Until registration completes, the site shows a "not registered" page. <!-- id:CciTeZv0 -->

A site's web app can run in two modes. **Single-site** mode keeps one `config.json` with the secret, the registered account and the source peer. **Multi-tenant** mode keeps a `service-config.json` with a root hostname, a config per named subdomain, and a map of custom domains to subdomains. The request's hostname selects the config. The hosted service on `hyper.media` runs the second mode. It drives it through `POST /hm/api/admin` with an admin secret: `create-service {name}` allocates a subdomain and returns its setup link, `create-custom-domain {hostname, service}` maps a domain onto it, `remove-service` and `remove-custom-domain` undo them, and `get-config` and `configure-service` read the whole service config and overwrite one subdomain's config. Subdomain names must match `^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`. <!-- id:FLlJwj3E -->

# `/hm/api/config` <!-- id:C2rHVBVH -->

This route describes the site. Any client that has only a web URL starts here: <!-- id:iqoqvxzu -->

```json <!-- id:3oZRzMh5 -->
{
  "registeredAccountUid": "z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS",
  "peerId": "12D3KooWEDdEeuY3oHCSKtn1eC7tU9qNWjF9bb8sCtHzpuCjvomQ",
  "protocolId": "/hypermedia/0.9.2",
  "signerAccountUid": "z6Mk…",
  "addrs": ["/dns4/hyper.media/udp/56001/quic-v1", "/dns4/hyper.media/tcp/56001"],
  "hostname": "https://hyper.media",
  "isGateway": true,
  "notifyServiceHost": "https://notify.hyper.media"
}
```

<!-- id:MXFhfPA5 -->
- `registeredAccountUid` is the space the site serves. <!-- id:XAUU6RZE -->
- `peerId` and `addrs` are how to reach its daemon. <!-- id:iOzjCMhe -->
- `protocolId` tells you whether your node can talk to it. <!-- id:nZx9yDva -->
- `signerAccountUid` is a key the web app generated for itself. The server signs with it on its own behalf, for example when a web visitor edits through the site. <!-- id:US2kbkxG -->
- `isGateway` is explained below. <!-- id:77d8-6PY -->

The route is public and answers any origin. The daemon's own HTTP port serves the same path with only `peerId`, `addrs` and `protocolId`, which is enough to bootstrap a libp2p connection from a URL. <!-- id:9Ba7hmw7 -->

The daemon keeps a **domain table**. Whenever it resolves a `siteUrl` it records the domain and re-checks `https://<domain>/hm/api/config` every 30 minutes, storing the last status (`success`, `unreachable`, `error`, `unknown`), the last successful config and the last error. `Daemon.GetDomain` returns that row. When the daemon has never fetched the domain, it falls back to what it knows locally: a home document whose `siteUrl` names the domain. `ListDomains` lists them all. The Seed app and the [SDK](../build/sdk.md) use this table to turn `https://example.com/about` into an `hm://` id without a network round trip when the domain was seen before. <!-- id:3vwDmSTZ -->

# Web URLs and canonical forms <!-- id:cG9dTe_Y -->

A site maps `hm://` URLs to web URLs and back. The rules, in order: <!-- id:XZAf5GTH -->
  - **Pretty paths.** For the site's own registered account, the path is the document path: `hm://<account>/about` is `https://example.com/about`. The home document is `https://example.com/`. <!-- id:ozXk193u -->
  - **The `/hm/` prefix.** Any Hypermedia URL becomes a web URL by replacing `hm://` with `/hm/` and appending the result to the site's origin: `hm://aliceaccount/wunderland?v=deadbeef#block-id-1` can be served as `https://example.com/hm/aliceaccount/wunderland?v=deadbeef#block-id-1`. A site must be able to render any document, including other accounts' documents, because documents link across spaces and a linked space may have no site at all. The reverse conversion needs to know only that the domain runs Hypermedia software. Even if a central server disappears, a saved `https://hyper.media/hm/…` link still names exactly one `hm://` resource. <!-- id:TrgCg85v -->
  - **Query and fragment** carry over unchanged: `?v=` for a [version](./documents.md), `&l` for "at least this version, prefer latest", `#block` and range selectors for [fragments](./urls.md). <!-- id:8Vl2rC1r -->
  - **Exports.** Appending `.md` or `.json` to the document segment returns the document as markdown or JSON instead of a page, with the same `?v=` and `?l` parameters. <!-- id:fJ7VKlmB -->

Some path prefixes are reserved on every site and must not be used as document paths: `/hm/` (the mapping above and the site services), `/ipfs/` (blobs by CID, as an IPFS gateway would), `/ipns/` (unused, reserved for compatibility), `/.well-known/` (the well-known URI convention) and `/api/` (the Seed API). The app discourages creating documents at those paths, and a site must keep working if someone does. <!-- id:0Kmj4Vv0 -->

Every rendered page also says which resource it is. A `GET` or `OPTIONS` on a document URL answers with `X-Hypermedia-Id`, `X-Hypermedia-Version`, `X-Hypermedia-Title`, `X-Hypermedia-Type` and `X-Hypermedia-Authors` headers, and the HTML carries the same facts as `<meta name="hypermedia_id">` and `<meta name="hypermedia_version">` tags. So a plain `curl -X OPTIONS -I https://example.com/about` turns a web link into an `hm://` id. The SDK's URL resolver does the same when the domain table has no answer. <!-- id:RuOzQwbm -->

A canonical-URL and robots policy (which of the pretty and `/hm/` forms search engines should index) is an open design note. The web app enforces no such policy today. <!-- id:cvcpH_oN -->

# What "gateway" means <!-- id:GVKLx353 -->

Three different things share the word: <!-- id:y-npdkKN -->
  1. **Bootstrap gateways** are the Seed servers compiled into every daemon's bootstrap list: `hyper.media`, `dev.hyper.media`, `staging.hyper.media` and one community node. They are ordinary site daemons that hold nearly everything public and form the first tier of every [discovery](./network.md). Being "connected to hyper.media" means having a libp2p connection to that peer. They are neither a DHT nor relays. <!-- id:Pn0X-y1U -->
  2. **The web gateway flag** is `SEED_IS_GATEWAY` on the web container, surfaced as `isGateway` in `/hm/api/config`. A gateway site serves canonical `/hm/<account>/…` URLs for any account instead of one registered space. It never starts discovery from a server-rendered request. An unknown document renders a placeholder page whose script polls `GET /api/DiscoveryStatus`, and that first poll starts the daemon's search. This keeps bots that probe thousands of nonexistent paths from queueing expensive discoveries. A non-gateway site discovers server-side and holds the request until the document arrives or times out. The daemon never reads this flag. It only passes it along in the domain table. <!-- id:IE2FYcpb -->
  3. **The IPFS file gateway** is the daemon's `GET /ipfs/<cid>` route, described on the [files](./files.md) page. <!-- id:d-3IAFRn -->

`hyper.media` is all three at once: a bootstrap peer, a gateway site, and a file gateway. <!-- id:Ao3D2HvH -->

# Hosted sites, subdomains and custom domains <!-- id:tJic59wR -->

The hosting service at `hyper.media` gives every space a free `<name>.hyper.media` site. You pick the name in the Seed app's "Publish Site" dialog and the app handles registration for you. Names shorter than four characters are not offered. Short names are rare, desirable and easy to squat, so they are held back. One server can host many spaces, but each space needs its own subdomain, and a subdomain is exactly one space. <!-- id:RtLN_wmL -->

A hosted site can also answer on a domain you own. In the Seed app, open the site's options and choose "Publish Custom Domain", enter the domain, and the app asks the hosting service to attach it. Then, at your DNS provider, point the domain at your site: an `ALIAS` or flattened `CNAME` record to `<name>.hyper.media` where the provider supports it. Otherwise use an `A` record to the address that `hyper.media` itself resolves to (check with `ping hyper.media`; it was `40.160.6.196` when this was written and may change). If you use Cloudflare, turn its proxy off for the record. Propagation usually takes about ten minutes. Keep the app open, and the site goes live on the custom domain once the hosting service sees the record. Self-hosted sites do the same thing with their own DNS and the compose file's hostname setting. <!-- id:juIMbSd2 -->

A site's content is never locked to its host. The space, the keys and the domain are yours. The [self-hosting guide](../build/self-hosting.md) shows how to move. <!-- id:NugUjt5W -->

# Working with sites <!-- id:ZrVZmke1 -->

## In the Seed app <!-- id:OTCkT2AZ -->

"Publish Site" on a space opens the registration dialog. Choose a free `hyper.media` subdomain, paste a self-hosted setup link, or follow the self-host instructions. After registration the space's settings show the site URL, and publishing a document pushes it to the site with progress per host. "Publish Custom Domain" attaches your own domain to a hosted site. The app's network dialog lists the site's peer among your connections, and the omnibar recognises `https://` site links and opens them as `hm://` resources. <!-- id:T9u6ThBM -->

## CLI <!-- id:4dXdxMfF -->

The [Seed CLI](../build/cli.md) always talks to a site. `--server https://example.com` (default `https://hyper.media`) picks the site to read from and publish through, and an `https://` argument is resolved against that site's own API. `seed-cli document create --site-url https://example.com` sets `siteUrl` on a home document from the command line. That is the only piece of registration the CLI can do. The secret handshake runs from the app. Give any URL argument and the CLI reads `/hm/api/config` or the `X-Hypermedia-*` headers to find the `hm://` id. The [CLI reference](../build/cli.md) lists the flags. <!-- id:J0zeLw5_ -->

## SDK <!-- id:-Hc7Y0HK -->

`createSeedClient('https://example.com')` is a client for that site's Seed API. `resolveHypermediaUrl(url)` turns a site URL into `{id, version, title, type, authors}`. It uses the domain table through `GetDomain` when available and an `OPTIONS` request otherwise. `resolveIdWithClient(url)` returns a client bound to the URL's own origin. `client.request('GetDomain', {domain, forceCheck?})` and `ListDomains` read the daemon's domain table. See the [SDK guide](../build/sdk.md). <!-- id:Oa5Mw7tL -->

## Web API <!-- id:zOGxt86t -->

The site services under `/hm/api/*` define a site: `GET /hm/api/config` (above), `POST /hm/api/register` (`{registrationSecret, accountUid, peerId, addrs}`; the desktop's registration call), `POST /hm/api/admin` (multi-tenant management with an admin secret), `POST /hm/api/discover` (`{uid, path[], version?, media?}`, blocking discovery on the site's daemon), `/hm/api/file/<cid>` and `/hm/api/image/<cid>` ([files](./files.md)), `/hm/api/auth` ([sign-in](../build/sign-in.md)) and `/hm/api/version`. The Seed API at `/api/<Key>` adds `GetDomain`, `ListDomains` and `DiscoveryStatus`. The pages `/hm/register?secret=…`, `/hm/create-site`, `/hm/connect#…` and `/hm/download` are human entry points. The [web API guide](../build/web-api.md) documents each with examples. <!-- id:QwJcmbsm -->

## Agents <!-- id:A5u2SJzU -->

[Seed Agents](../agent.md) and external agents address sites the same way the CLI does. A hosted agent reads and writes through `https://hyper.media` (or the server it was configured with). It can [`read`](../agent/read.md) `https://example.com/about`, which resolves through the site's headers to an `hm://` id before reading. A space can name an [agents server](../apps/agents.md) in its home document [metadata](../metadata.md) as `agentServerUrl`, and list the agents it exposes to visitors as `spaceAgents`. Then a site's readers see the site's agents in the assistant panel. An agent that drives a site with `curl` uses `/hm/api/config` to learn the account and `/api/DiscoveryStatus` to wait for a document. See [using Seed from your own agent](../build/agents.md). <!-- id:8gEtDl6R -->

# Where this is going <!-- id:FDKsYfXW -->

As of September 2026, the open items around sites are the canonical-URL and robots policy for search engines, exposing subscriptions and domain management through the public API as well as gRPC, and the broader HM26 direction on the [roadmap](./roadmap.md). In that direction a site's authority over a space becomes an explicit, signed relationship instead of a `siteUrl` string plus an HTTPS lookup. <!-- id:Wlc_KMNW -->

# See also <!-- id:S_PCOiHH -->

- [Network](./network.md): how a site's peer takes part in discovery and sync. <!-- id:f0JS7Fre -->
- [Files](./files.md): the `/ipfs` gateway and image service every site exposes. <!-- id:Yfcs-hNU -->
- [URLs](./urls.md): the full `hm://` grammar behind the web mapping. <!-- id:F-gd7IHD -->
- [Identity](./identity.md) and [Permissions](./permissions.md): accounts, the site's own signing key, and who may write to a space. <!-- id:M5ipgAsr -->
- [Self-hosting](../build/self-hosting.md) and [Web API](../build/web-api.md): running a site and talking to one. <!-- id:U1Ahpril -->
- [Metadata](../metadata.md): the `siteUrl` and `agentServerUrl` keys on the home document. <!-- id:zJmqnVNa -->
