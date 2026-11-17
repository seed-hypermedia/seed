---
name: Sites
summary: A site is a space published at a web domain by a server that holds the space's content, answers for it on the network, and renders it as ordinary web pages.
---
A **site** is a [space](./spaces.md) (an account's namespace of [documents](./documents.md)) published at a web domain. Anyone with a browser can read it at `https://example.com/about`. Anyone with a Seed node can reach the same content as [`hm://<account>/about`](./urls.md). The site's server is a normal Seed node running on a server, plus a web app in front of it. <!-- id:DFpPyir5 -->

Sites connect the peer-to-peer [network](./network.md) to the web. They give a space a stable place on the internet, a server that is always online to answer for it, and a way to reach readers who have never installed anything. <!-- id:9u1VzQZ1 -->

# What a site is made of <!-- id:BmzKnjvt -->

A site runs three programs behind one domain: the [Seed daemon](../software/daemon.md), which is the libp2p peer that stores and serves the space's blobs; the [Seed web app](../software/web.md), which renders documents as HTML, exposes the [Seed API](../build/web-api.md) at `/api/<Key>` and the site services at `/hm/api/*`, and owns the registration state; and a reverse proxy that terminates HTTPS and sends `/ipfs/*` straight to the daemon. An optional [notify service](../software/notify.md) sends email notifications for the site. The [self-hosting guide](../operate/self-hosting.md) gives the containers, ports and flags.

The daemon has no "site mode" and no site-registration RPC. It does not know it is a site. Two facts that other nodes observe make it one: its web app advertises a registered account at `/hm/api/config`, and the space's home document names the site's URL. <!-- id:EkMy1d8X -->

# The home document and `siteUrl` <!-- id:Xw4m9P2- -->

Every space has a home document at the empty path. `hm://<account>` is its URL, and its `name` and `icon` become the site's title and favicon. When a space is registered with a site, the Seed app writes the site's origin into the home document's [metadata](../metadata.md) as `siteUrl` (for example `https://example.com`). <!-- id:C8gsd858 -->

That one attribute does a lot. Every node that reads the home document learns where the space lives on the web. The daemon resolves the space's **site peer** by fetching `https://<siteUrl>/hm/api/config`. It treats that peer as the authority tier in [discovery](./network.md). It authenticates to that peer when it holds a [writer](./permissions.md) key for the space, includes [private](./privacy.md) blobs in pushes to it, and lets that peer read the space's private content. A reader's app also uses the URL to offer "open on the web", and the web app uses it to build pretty links. So whoever controls the HTTPS endpoint named in `siteUrl` holds real trust; see [Integrity](./integrity.md). <!-- id:PxABJFy5 -->

# Registration <!-- id:TyVck7XM -->

Registering binds one account to one site. It is a short handshake between the site's web app and the [Seed app](../software/desktop.md) that holds the [account](./identity.md) key: <!-- id:M5k-KNiO -->
  1. The site's operator (or the hosting service on their behalf) puts a one-time secret into the site's configuration. The setup link looks like `https://example.com/hm/register?secret=…`. <!-- id:z7tmjsEM -->
  2. The account owner opens "Publish Site" in the Seed app and pastes that link. The app fetches `/hm/api/config` and refuses if the site is already registered to a different account. <!-- id:UwGKR5Nl -->
  3. The app posts `{registrationSecret, accountUid, peerId, addrs}` to `POST /hm/api/register`. The web app checks the secret, tells its daemon to connect to the app's peer, stores `registeredAccountUid` in its config, and subscribes its daemon recursively to the account's whole space so it stays current from then on. <!-- id:XWHdTS1E -->
  4. The app connects to the site's peer and pushes the space's home document, with its related material, to it with `PushResourcesToPeer`. The rest of the space arrives through the site's recursive subscription. <!-- id:0KAP3DFV -->
  5. The app publishes a new version of the home document with `siteUrl` set to the site's origin. <!-- id:eZstjI_3 -->

From that moment `/hm/api/config` advertises the account, the site's pages render that account's home document, and other nodes treat the site's peer as the authority for the space. Until registration completes, the site shows a "not registered" page. <!-- id:CciTeZv0 -->

One web app can serve one site or many. In single-site mode it holds one registration. In multi-tenant mode it holds one registration per subdomain and a map of custom domains to subdomains, and the request's hostname selects the site. The hosted service on `hyper.media` runs the second mode.

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
  "notifyServiceUrl": "https://hyper.media/hm/api/notify",
  "notifyServiceHost": "https://hyper.media",
  "appEnvironmentUrl": "https://hyper.media/hm/api/apps",
  "agentServerUrl": "https://hyper.media/hm/api/apps"
}
```

<!-- id:MXFhfPA5 -->
- `registeredAccountUid` is the space the site serves. <!-- id:XAUU6RZE -->
- `peerId` and `addrs` are how to reach its daemon. <!-- id:iOzjCMhe -->
- `protocolId` tells you whether your node can talk to it. <!-- id:nZx9yDva -->
- `signerAccountUid` is a key the web app generated for itself. The server signs with it on its own behalf, for example when a web visitor edits through the site. <!-- id:US2kbkxG -->
- `isGateway` is explained below. <!-- id:77d8-6PY -->
- `notifyServiceUrl` is the base URL of the notify service the site uses, normally `<origin>/hm/api/notify` on the site itself or on hyper.media. `notifyServiceHost` is the same service's origin; an app that reads this field appends `/hm/api/notifications` to it. See [notify](../software/notify.md). <!-- id:XshHZBYw -->
- `appEnvironmentUrl` is the site's default [app environment](../software/app-environment.md): `<origin>/hm/api/apps` on the site itself (the site's proxy sends that path to the app environment, as hyper.media and its subdomains do), or null. `agentServerUrl` carries the same value under a second name. Readers take `appEnvironmentUrl` first and fall back to `agentServerUrl`. <!-- id:f7j5k8HS -->

The route is public and answers any origin. The daemon's own HTTP port serves the same path with only `peerId`, `addrs` and `protocolId`, which is enough to bootstrap a libp2p connection from a URL. <!-- id:9Ba7hmw7 -->

The daemon keeps a **domain table**. Whenever it resolves a `siteUrl` it records the domain and re-checks `https://<domain>/hm/api/config` every 30 minutes, storing the last status (`success`, `unreachable`, `error`, `unknown`), the last successful config and the last error. `Daemon.GetDomain` returns that row. When the daemon has never fetched the domain, it falls back to what it knows locally: a home document whose `siteUrl` names the domain. `ListDomains` lists them all. The Seed app and the [SDK](../build/sdk.md) use this table to turn `https://example.com/about` into an `hm://` id without a network round trip when the domain was seen before. <!-- id:3vwDmSTZ -->

# Web URLs <!-- id:cG9dTe_Y -->

A site serves its own space at pretty paths: `hm://<account>/about` is `https://example.com/about`, and the home document is `https://example.com/`. It also serves any document of any space under the `/hm/` prefix, so `hm://<account>/<path>` is always `https://example.com/hm/<account>/<path>`. [URLs](./urls.md) gives the full mapping, the `X-Hypermedia-*` headers that turn a web link back into an `hm://` id, the `.md` and `.json` exports, and the path segments a site reserves.

The web app sets no policy on which of the two forms search engines index.

# What "gateway" means <!-- id:GVKLx353 -->

Three different things share the word: <!-- id:y-npdkKN -->
  1. **Bootstrap gateways** are the Seed servers compiled into every daemon's bootstrap list: `hyper.media`, `dev.hyper.media`, `staging.hyper.media` and one community node. They are ordinary site daemons that hold nearly everything public and form the first tier of every [discovery](./network.md). Being "connected to hyper.media" means having a libp2p connection to that peer. They are neither a DHT nor relays. <!-- id:Pn0X-y1U -->
  2. **The web gateway flag** is `SEED_IS_GATEWAY` on the web container, surfaced as `isGateway` in `/hm/api/config`. A gateway site serves canonical `/hm/<account>/…` URLs for any account instead of one registered space. It never starts discovery from a server-rendered request. An unknown document renders a placeholder page whose script polls `GET /api/DiscoveryStatus`, and that first poll starts the daemon's search. This keeps bots that probe thousands of nonexistent paths from queueing expensive discoveries. A non-gateway site discovers server-side and holds the request until the document arrives or times out. The daemon never reads this flag. It only passes it along in the domain table. <!-- id:IE2FYcpb -->
  3. **The IPFS file gateway** is the daemon's `GET /ipfs/<cid>` route, described on the [files](./files.md) page. <!-- id:d-3IAFRn -->

`hyper.media` is all three at once: a bootstrap peer, a gateway site, and a file gateway. <!-- id:Ao3D2HvH -->

# Hosted sites, subdomains and custom domains <!-- id:tJic59wR -->

The hosting service at `hyper.media` gives every space a free `<name>.hyper.media` site. You pick the name in the Seed app's "Publish Site" dialog and the app handles registration for you. Names shorter than four characters are not offered. Short names are rare, desirable and easy to squat, so they are held back. One server can host many spaces, but each space needs its own subdomain, and a subdomain is exactly one space. <!-- id:RtLN_wmL -->

A hosted site can also answer on a domain you own. "Publish Custom Domain" in the Seed app asks the hosting service to attach the domain, and a DNS record at your provider points the domain at the site. A self-hosted site uses its own DNS and hostname setting. The [self-hosting guide](../operate/self-hosting.md) has the steps for both.

A site's content is never locked to its host. The space, the keys and the domain are yours. The [self-hosting guide](../operate/self-hosting.md) shows how to move. <!-- id:NugUjt5W -->

# Working with sites <!-- id:ZrVZmke1 -->

Publishing a space as a site happens in the [Seed app](../software/desktop.md): "Publish Site" on a space runs the registration above. The other tools read a site and publish through one:

- **CLI.** `--server https://example.com` picks the site to read from and publish through. `seed-cli document create --site-url https://example.com` sets `siteUrl` on a home document, which is the only part of registration the CLI does. See the [CLI reference](../build/cli.md).
- **SDK.** `createSeedClient('https://example.com')` is a client for that site's Seed API, and `client.request('GetDomain', {domain})` reads the daemon's domain table. See the [SDK guide](../build/sdk.md).
- **Web API.** `GET /hm/api/config` describes the site, and `POST /hm/api/register` is the registration call. The [web API guide](../build/web-api.md) lists every site service under `/hm/api/*`.
- **Agents.** A space names an app environment in its home document [metadata](../metadata.md), and lists the agents it shows to visitors as `spaceAgents`. See [using Seed from your own agent](../build/agents.md).

# See also <!-- id:S_PCOiHH -->

- [Network](./network.md): how a site's peer takes part in discovery and sync. <!-- id:f0JS7Fre -->
- [Files](./files.md): how images and attachments reach a site's readers. <!-- id:Yfcs-hNU -->
- [URLs](./urls.md): the full `hm://` grammar and the web mapping. <!-- id:F-gd7IHD -->
- [Spaces](./spaces.md): the space, its paths and its home document.
- [Identity](./identity.md) and [Permissions](./permissions.md): accounts, the site's own signing key, and who may write to a space. <!-- id:M5ipgAsr -->
- [Self-hosting](../operate/self-hosting.md) and [Web API](../build/web-api.md): running a site and talking to one. <!-- id:U1Ahpril -->
- [Metadata](../metadata.md): the `siteUrl`, `appEnvironmentUrl` and `agentServerUrl` keys on the home document. <!-- id:zJmqnVNa -->
