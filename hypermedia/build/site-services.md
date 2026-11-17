---
name: Site services
summary: The fixed routes every Seed site serves beside the Seed API, from /hm/api/config and sign-in to files, exports and resolving a web URL to an hm:// id.
---
A Seed [site](../protocol/sites.md) answers two families of HTTP requests. The [Seed API](./web-api.md) is the typed surface under `/api/<Key>`. This page is the reference for everything else the [web server](../software/web.md) serves to programs: the `/hm/api/*` routes that make a site a site, files and raw [blobs](../protocol/blobs.md) under `/ipfs`, document exports by extension, and the headers that turn a web URL into an `hm://` id.

# The /hm/api routes <!-- id:t5vOz0nD -->

These routes exist so that a site can be a site. Most are called by the Seed app or by the site's own pages. Three are useful to integrators. <!-- id:4deSzBOW -->

<!-- id:PKELLSlU -->
| Route <!-- col:UhI8xWLl --> | Method <!-- col:mznQCc-8 --> | Purpose <!-- col:tXMDDkZA --> <!-- id:17H0puft --> |
| --- | --- | --- |
| `/hm/api/config` | GET | `{registeredAccountUid, siteUrl, peerId, protocolId, signerAccountUid, addrs, hostname, isGateway, notifyServiceUrl, notifyServiceHost, appEnvironmentUrl, agentServerUrl, requireSignIn}`; CORS open, no auth. `notifyServiceUrl` is the notify service's base URL (canonically `<origin>/hm/api/notify`) and `notifyServiceHost` its origin, kept for older clients; `agentServerUrl` is the app environment the web app uses, or null. The one call to learn which space a domain publishes and how to reach its daemon. `siteUrl` is what the registered space's home document says its address is (null when unregistered), so an operator can see when it has fallen behind `hostname`. <!-- id:EdR0gB7w --> |
| `/hm/api/auth` | POST, DELETE, OPTIONS | protobuf `AuthenticateRequest` in, bearer cookie out; DELETE clears it <!-- id:DylsGsu- --> |
| `/hm/api/version` | GET | `{web: {commit, branch, date}, daemon: {commit, branch, date}}` <!-- id:RTaB8Y2L --> |
| `/hm/api/file/<cid>` | GET | streams `/ipfs/<cid>` through the web server, forwarding `Range` and the visitor's cookie <!-- id:inUY6yej --> |
| `/hm/api/image/<cid>?size=S,M,L,XL` | GET | the image resized to 120, 650, 1600 or 4000 px wide as PNG; GIFs pass through <!-- id:1V1AxxRB --> |
| `/hm/api/content-image?space=&path=&version=` | GET | the 1200 by 630 Open Graph image of a document <!-- id:6F0-xMQC --> |
| `/hm/api/discover` | POST JSON `{uid, path, version?, media?}` | make the site fetch a document now, blocking until done; `DiscoveryStatus` is the non-blocking form <!-- id:B6aHtARB --> |
| `/hm/api/register` | POST JSON `{registrationSecret, accountUid, peerId, addrs}` | bind a space to this site; the Seed app calls it from the registration link <!-- id:L-bWaPhS --> |
| `/hm/api/admin` | POST JSON `{adminSecret, adminAction}` | the multi-tenant control plane of a hosting service; disabled unless the operator sets a secret <!-- id:zvYNQVy0 --> |
| `/hm/api/site-image` | POST bytes | square-crop an icon to 512 px <!-- id:RGnDHd0E --> |
| `/hm/api/document-update` | POST CBOR | stores a change, a ref and an icon; accepted for older clients, which should use `PublishBlobs` <!-- id:pFA2fmSk --> |
| `/hm/api/resource/<uid>/<path>?v=&l` | GET | superjson `Resource`; accepted for older clients, which should use `GET /api/Resource?id=` <!-- id:D_p52ly6 --> |

```sh <!-- id:Q9pBqSvo -->
curl https://hyper.media/hm/api/config
```

```json <!-- id:9sTFtDRg -->
{"registeredAccountUid":"z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB","peerId":"12D3KooWEDdEeuY3oHCSKtn1eC7tU9qNWjF9bb8sCtHzpuCjvomQ","protocolId":"/hypermedia/0.9.2","signerAccountUid":"z6MktB9d9djZFYDzrQ8jpgveVpjdBADZDtQUFaU8ygD37YYU","addrs":["/dns4/hyper.media/tcp/56001/p2p/12D3KooWEDdEe…","/dns4/hyper.media/udp/56001/quic-v1/p2p/12D3KooWEDdEe…"],"hostname":"https://hyper.media","isGateway":true,"notifyServiceUrl":"https://hyper.media/hm/api/notify","notifyServiceHost":"https://hyper.media","appEnvironmentUrl":"https://agentic.seed.hyper.media","agentServerUrl":"https://agentic.seed.hyper.media"}
```

Email notification endpoints (`/hm/api/notify/*`, and the older `/hm/api/notifications`, `/hm/api/notification-config`, `/hm/api/public-subscribe` and friends) are not part of the web server. The reverse proxy routes them to the [notify service](../software/notify.md), which `/hm/api/config` advertises as `notifyServiceUrl`. The web server only serves the email settings page, `/hm/email-notifications`. There is no sitemap, no RSS and no `.well-known` route. `robots.txt` allows everything. <!-- id:lCPdAtXB -->

Bearer tokens, the cookie that `/hm/api/auth` sets and what they unlock are described under [authentication](./web-api.md#authentication). The routes of an app environment mounted on a site, `/hm/api/apps/*` and `/hm/api/agents/*`, are the [signed API](./signed-api.md).

# Resolving a web URL to an hm:// id <!-- id:5599mNtx -->

Any document URL on a site answers `OPTIONS` with the document's identity in headers. This is how the SDK and the CLI turn a pasted `https://` link into an id without parsing HTML. <!-- id:JEG4ggkl -->

```sh <!-- id:rFTwjIti -->
curl -X OPTIONS -I 'https://seed.hyper.media/resources/self-host-seed'
```

``` <!-- id:1czTZdiN -->
HTTP/2 200
access-control-expose-headers: X-Hypermedia-Id, X-Hypermedia-Version, X-Hypermedia-Title, X-Hypermedia-Target, X-Hypermedia-Authors, X-Hypermedia-Type
x-hypermedia-id: hm%3A%2F%2Fz6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS%2Fresources%2Fself-host-seed
x-hypermedia-version: bafy2bzacedia6ddwuoefhwcujtlwzwffshysz6peixz7pndfrjchtoqry7qt6
x-hypermedia-title: Self-Host%20a%20Seed%20Website
x-hypermedia-type: Document
x-hypermedia-authors: hm%3A%2F%2Fz6MkfnCSnmstMXTAb6MBXXCj4zdPwZedtRF6YBgYtE5Q8Sov,hm%3A%2F%2Fz6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4,…
```

Values are URL-encoded. `X-Hypermedia-Type` is `Document` or `Comment`. A comment URL adds `X-Hypermedia-Target` with the document it belongs to. The same headers ride on the `GET` of the page, and the page's HTML repeats them as `<meta name="hypermedia_id">` and similar tags. When the URL cannot be resolved the response is still `200`, with only the CORS headers, so check for `X-Hypermedia-Id` before trusting it. The URL grammar itself is in [URLs](../protocol/urls.md). <!-- id:Tfi-AcNW -->

# Exports: append .md or .json <!-- id:DSZtbGLl -->

A site exports any document by extension on the document segment. There is no `Accept` negotiation. <!-- id:WZAHqkzi -->

<!-- id:4OPosWaZ -->
| URL <!-- col:78Ik-Lx_ --> | Returns <!-- col:Ve2CbClB --> <!-- id:Qm4O3StL --> |
| --- | --- |
| `/<path>.md`, `/hm/<uid>/<path>.md` | the document as markdown with frontmatter, mentions resolved and query blocks executed; `text/markdown` <!-- id:ztNPErKU --> |
| `/<path>.json` | the `Resource` payload as plain JSON (not superjson) <!-- id:xWwci829 --> |
| `/<path>.md/:comments`, `/<path>.md/:comments/<uid>/<tsid>` | the discussion, or one comment <!-- id:0lYsx7wc --> |
| `/<path>.md/:attributes` | the document's attributes <!-- id:EUIUduJa --> |
| `/<path>.json/:activity`, `…/:activity/comments`, `…/:activity/versions`, `…/:activity/citations` | activity views, paged with `?pageSize=&pageToken=` <!-- id:_jcl4I6Y --> |
| `/<path>.json/:collaborators`, `/<path>.json/:directory`, `/<path>.json/:all-documents` | collaborators, direct children, the whole subtree <!-- id:Q6SWm12m --> |

`?v=<version>` pins a version and `?l` forces latest, as on the page itself. Exports are cached for a minute (`Cache-Control: public, max-age=60`) and carry the `X-Hypermedia-*` headers. <!-- id:ttYQwwlG -->

```sh <!-- id:qkoUs5H9 -->
curl 'https://seed.hyper.media/resources/self-host-seed.md' | head -6
```

``` <!-- id:SXe_w9UH -->
---
name: Self-Host a Seed Website
cover: ipfs://bafkreie6wls4wzt26vl3smvcc5smulmbostaokyftwmig2ojfpkhbmbee4
---

If you want to publish on your own domain without relying on our service, you are welcome to self-host your site. …
```

# Files and raw blobs: /ipfs/\<cid> <!-- id:L-MCdmz3 -->

`GET /ipfs/<cid>` returns the bytes behind any content id the site's daemon holds or can fetch: an image, a PDF, or a signed blob. [Files](../protocol/files.md) stored as [UnixFS](https://github.com/ipfs/specs/blob/main/UNIXFS.md) are reassembled. Range requests work, and `?filename=` sets the download name. The content type is always `application/octet-stream`, so sniff it yourself. Append `.dagjson` to see a structural blob decoded. <!-- id:zRysFSke -->

```sh <!-- id:m4FB0925 -->
curl 'https://hyper.media/ipfs/bafy2bzacedia6ddwuoefhwcujtlwzwffshysz6peixz7pndfrjchtoqry7qt6.dagjson'
```

```json <!-- id:qCE496h_ -->
{
  "body": {"opCount": 1, "ops": [{"block": {"id": "B_AgOiKa", "text": "curl -fsSL https://deploy.seed.hyper.media | sh", "type": "Code", "language": ""}, "type": "ReplaceBlock"}]},
  "deps": [{"/": "bafy2bzaceboabcqmrardnurha7lfk3rrnochhhgokqw26eid77hcvymre2fgs"}],
  "depth": 3,
  "genesis": {"/": "bafy2bzacedvbzyb7237wk44qnl7fdu7i24aurdkjzcctleuyqlsjckcynbqru"},
  "sig": {"/": {"bytes": "/UZZZ5CuMvn1efgys7OXDhpthz3UB53PeXAV008LW9i72T/9KW+gebQU6U6s1w+9uPB6f6SBZxD0QsC/rZ+YCw"}},
  "signer": {"/": {"bytes": "7QG0a+na…"}},
  …
}
```

On hosted sites this path goes straight to the daemon, bypassing the web server, so a bearer cookie does not reach it. A daemon looks for an unknown id on the network for up to a minute before answering `408`, and a blob that no public document, comment or profile links to is not served as public even when stored. [Files](../protocol/files.md) covers this. <!-- id:woMuykbI -->

# See also

- [Seed API](./web-api.md)
- [Web server](../software/web.md)
- [Sites](../protocol/sites.md)
- [URLs](../protocol/urls.md)
- [Files](../protocol/files.md)
- [Sign in with Seed](./sign-in.md)
- [Self-hosting](../operate/self-hosting.md)
