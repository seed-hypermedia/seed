---
name: Seed API
summary: The HTTP API every Seed site serves, from the typed request keys under /api to the site services under /hm/api, with real requests and responses.
---
Every Seed site is also an API server. The same web server that renders `https://hyper.media` answers plain HTTP requests for documents, comments, search results and accounts, and accepts signed blobs for publishing. You do not need to run anything to read from the network: a `curl` against any site is enough.

This page is the reference for that surface. Two families live on a site. The **Seed API** is the typed request surface under `/api/<Key>`, where a key such as `Resource` or `Search` names one request with a declared input and output. The **site services** are the fixed routes under `/hm/api/*` that a site needs to be a site: its configuration, authentication, files, images, registration. The SDK, the CLI and Seed Agents all speak the Seed API; a few of the site services matter to integrators too.

# Base URLs

A site's origin is the base URL. The key follows `/api/`, and the input rides in the query string for reads or in the body for writes.

| Base URL | What answers | Notes |
| --- | --- | --- |
| `https://hyper.media` | the public gateway | serves every public account under `/hm/<uid>/…`; the SDK and CLI default |
| `https://<any site>` | that site's web server | same handlers; the site's daemon holds its own space plus whatever it has synced |
| `http://localhost:56004` | the Seed desktop app | the app's local bridge, serving the same keys against your own daemon; `58004` in a dev build |
| `http://localhost:3000` | a Seed web app you run yourself | `PORT` in [self-hosting](./self-hosting.md) |

The gateway answers for accounts it knows about. A site's own space is always there; other accounts are there when the site has synced them. If a resource is unknown, the `Resource` key answers `not-found` in the payload and the site starts discovering it in the background; see `DiscoveryStatus` below.

# Calling the Seed API

## Reads are GET requests

Read keys are `GET /api/<Key>?…`. The query string is the key's input, encoded in one of three ways. The SDK picks the right one for you; when you hand-write requests you need to know which applies.

| Encoding | Which keys | How the input travels |
| --- | --- | --- |
| flat params | `Account`, `Resource`, `ResourceMetadata`, `ListCitations`, `ListChanges`, `ListCapabilities`, `ListDocumentCollaborators`, `DiscoveryStatus` | human-readable keys: `?id=hm://…`, `?targetId=hm://…`, `?uid=…&path=…` |
| JSON values | every other key whose input is an object | each top-level field is one query parameter; primitives as-is, nested objects and arrays as JSON strings (URL-encoded) |
| `__value` | keys whose input is a bare string: `Comment`, `AccountContacts`, `SubjectContacts` | `?__value=<the string>` |

The simplest read is a document by its `hm://` id.

```sh
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

```json
{"json":{"type":"document","id":{"id":"hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed","uid":"z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS","path":["resources","self-host-seed"],"version":null,"latest":true,…},"document":{"content":[{"children":[],"block":{"type":"Paragraph","id":"OtLkse-T","text":"If you want to publish on your own domain…","annotations":[],"attributes":{},"link":""}},…],"metadata":{"name":"Self-Host a Seed Website","cover":"ipfs://bafkreie6…"},"version":"bafy2bzacedia6…","genesis":"bafy2bzacedvbz…","authors":["z6MkfnCSnmst…"],…}}}
```

An account is read by its uid. The answer is the account's home document metadata.

```sh
curl 'https://hyper.media/api/Account?id=z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS'
```

```json
{"json":{"type":"account","id":{"id":"hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS","uid":"z6Mko5np…","path":[],"version":"bafyreigjdxq…"},"metadata":{"name":"Seed Hypermedia","icon":"ipfs://bafkreihpk5…","siteUrl":"https://seed.hyper.media","contentWidth":"L",…}},"meta":{"values":{"metadata.summary":["undefined"]}}}
```

A search takes JSON-encoded values. `query` is a plain string; a number stays a number.

```sh
curl 'https://hyper.media/api/Search?query=%22hypermedia%22&pageSize=2'
```

```json
{"json":{"entities":[{"id":{"id":"hm://z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB","uid":"z6MkfzKM…","path":[],"version":"bafyreienub…","latest":true},"title":"Hypermedia","icon":"ipfs://bafkreifcj…","parentNames":[],"versionTime":"6/8/2026, 11:57:06 PM","searchQuery":"hypermedia","type":"document"},…],"searchQuery":"hypermedia","nextPageToken":"…"}}
```

A key with an object input, such as `ListComments`, takes the object as a JSON string in one parameter. The SDK writes `?targetId=%7B%22uid%22%3A%22z6Mk…%22%2C%22path%22%3A%5B%22resources%22%5D%7D`; by hand it is easier to let the SDK or the CLI do it.

## Writes are POST requests with a CBOR body

Write keys are `POST /api/<Key>` with the input encoded as [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) and `Content-Type: application/cbor`. The server does not check the content type, but the body must decode as CBOR. There are two write keys that matter and a handful of listing keys that happen to use POST.

`PublishBlobs` is how anything gets onto the network. Its input is `{blobs: [{cid?, data}]}`, where `data` is the bytes of a signed blob and `cid` is that blob's content id. The server stores the blobs in the site's daemon, which verifies the signature of every structural blob it recognises and indexes it. The output is `{cids: [...]}`.

Give every blob its `cid`. When you omit it, the daemon computes the id with its own default hash, [BLAKE2b](https://www.blake2.net/), while the SDK computes SHA-256 ids. A blob that another blob points at by id must therefore carry the SHA-256 id you computed when you signed it, or the link will not resolve. [Blobs](../protocol/blobs.md) explains the two hashes.

`PrepareDocumentChange` asks the daemon to build an unsigned [Change](../change.md) for you from a list of edit operations, so you do not have to compute the change DAG yourself. The input is `{account, path?, baseVersion?, changes: [{op: {case, value}}], capability?, visibility?}`, the output `{unsignedChange: bytes}`. You sign the bytes and publish the result with `PublishBlobs`; the SDK does the whole sequence in `publishDocument`.

The remaining POST keys, `QueryDocuments`, `ListDocumentAttributeNames`, `ListDocumentAttributeValues`, `ListAccounts` and `ListUnreferencedDocuments`, are pass-throughs to the daemon's own request messages. Their body is the CBOR encoding of the protobuf JSON form of the request, with lowerCamelCase field names and enum names as strings, and they answer with plain protobuf JSON rather than the envelope described next. `QueryDocuments` is the attribute query surface; its filter grammar is in [query grammar](./query-grammar.md).

## Two response envelopes

Every read key and the two publishing keys answer `200` with a JSON body wrapped by [superjson](https://github.com/flightcontrolhq/superjson): `{"json": <output>, "meta"?: …}`. The `meta` member appears when the output holds a Date, a bigint or an explicit `undefined`, as in the `Account` response above. Unwrap by taking `json`, or let superjson restore the types for you. The pass-through keys answer with the daemon's protobuf JSON unwrapped; the SDK tells the two apart by looking for a top-level `json` member.

Not-found is never an HTTP status. `Resource` answers one of six shapes in the payload: `document`, `comment`, `redirect` (with `redirectTarget` and `republish`), `not-found`, `tombstone` or `error`. Handle the shape, not the status.

## Errors

| Status | When |
| --- | --- |
| `400` | no key in the path; a POST body that fails CBOR decoding or input validation (the message names the field) |
| `404` | an unknown key; the body is `{"error":"Unknown query key: <Key>"}` or `Unknown action key` |
| `500` | anything the handler threw, including daemon errors; the body is `{"error": <message>}` |
| `204` | `OPTIONS` preflight |

```sh
curl -w ' [%{http_code}]' 'https://hyper.media/api/Nope'
```

```
{"error":"Unknown query key: Nope"} [404]
```

## Headers, CORS and caching

Every Seed API response carries these headers.

```
content-type: application/json; charset=utf-8
cache-control: private, no-store
access-control-allow-origin: *
access-control-allow-methods: GET, POST, OPTIONS
access-control-allow-headers: Content-Type, Authorization
```

Any web page may call the API cross-origin. Because the server never sends `Access-Control-Allow-Credentials`, a cross-origin browser call cannot use the site's auth cookie; send an `Authorization` header instead. Nothing is cached, which is right for a view that depends on who asks.

## Authentication

Reading public content needs nothing. Authentication matters in two cases: reading content the site holds as private, and writing on behalf of a signed-in visitor through `PrepareDocumentChange`. In both, the site forwards a **daemon bearer token** to its daemon, and the daemon decides.

A token is proof that you hold an account key. `POST /hm/api/auth` takes a binary protobuf `AuthenticateRequest {account, timestamp, signature}`, where the signature covers an ephemeral [capability](../capability.md) naming the site daemon's peer id as audience, and the timestamp must be within five minutes of the daemon's clock. The daemon mints a token that lives thirty days, and the web server sets it as an `httpOnly` cookie named `__Host-HM-Auth-Token` (`HM-Auth-Token` outside production). The web app does this for you after "Sign in with Seed"; see [sign-in](./sign-in.md).

For a script or an agent, pass the token yourself: `Authorization: Bearer <token>` on any `/api/*` request. An explicit header wins over the cookie and is forwarded verbatim to the daemon. Two limits to know: a daemon only issues tokens for principals it has already seen in a signed blob, so a brand-new key must publish something first, and a token cannot be revoked individually; only the daemon operator can invalidate all of them at once.

Writing does not need a token. Authority to write is in the blob: a [Ref](../ref.md) signed by the space owner, or by a key that holds a [capability](../protocol/permissions.md) from the owner, is accepted from anyone who submits it. A comment signed by any key is accepted on any public document.

## Discovering the API

`GET /api/schema` lists every key with its method and path; `GET /api/schema?key=<Key>` returns one key's input and output as [JSON Schema](https://json-schema.org/), along with how the input is encoded.

```sh
curl 'https://hyper.media/api/schema?key=Resource'
```

```json
{"key":"Resource","kind":"query","method":"GET","path":"/api/Resource","inputEncoding":"query-string","outputEncoding":"application/json","outputSerialization":"superjson","usesParamMapping":true,"inputSchema":{"$ref":"#/definitions/ResourceInput","definitions":{"ResourceInput":{"type":"object","properties":{"id":{"type":"string"},"uid":{"type":"string"},"path":{"anyOf":[{"type":"array","items":{"type":"string"}},{"type":"null"}]},"version":{"type":["string","null"]},…}}}},"outputSchema":{…}}
```

`?kind=query` or `?kind=action` filters the list. One inaccuracy to know: the schema advertises `outputSerialization: superjson` for the pass-through keys too, whose real answer is plain protobuf JSON. The same contract is also published as [Hypermedia Schemas](../rpc.md), one page per key, and the Seed app renders a live console from them.

# The keys

Inputs are given as the fields you send; read the exact shapes from `GET /api/schema?key=` or the [rpc](../rpc.md) pages. `id`-like inputs are an unpacked hm id `{uid, path, version?, latest?, blockRef?}`; in flat encoding you send the packed `hm://` string.

## Read keys

| Key | Input | Output |
| --- | --- | --- |
| `Resource` | `id=hm://…` (flat) | the resource: `document`, `comment`, `redirect`, `not-found`, `tombstone` or `error` |
| `ResourceMetadata` | `id=hm://…` (flat) | `{id, metadata, hasSite?}` for a document, without its body |
| `Account` | `id=<uid>` (flat) | `{type:'account', id, metadata, hasSite?}` or `{type:'account-not-found', uid}`; follows aliases |
| `Comment` | `__value=<author>/<tsid>` | one comment |
| `AccountContacts` | `__value=<uid>` | the contacts an account has published |
| `SubjectContacts` | `__value=<uid>` | the contacts that name an account as subject |
| `Search` | `query`, `accountUid?`, `searchType?`, `pageSize?`, `pageToken?`, `iriFilter?`, `contentTypeFilter?`, `entityKindFilter?`, `perspectiveAccountUid?`, `contextSize?`, `includeBody?` | `{entities: [{id, title, icon, parentNames, type, versionTime?, commentId?}], searchQuery, nextPageToken}` |
| `MentionCandidates` | `mode` (`account` or `document`), `query`, `perspectiveAccountUid?`, `siteUid?`, `documentId?`, `seedIds?` | up to 100 candidates for an `@` mention |
| `Query` | `includes: [{space, path?, mode: 'Children' or 'AllDescendants'}]`, `sort?`, `limit?` | `{in, results: DocumentInfo[], mode?}` or `null`; the same shape a Query block embeds |
| `QueryBlock` | `{query}` | the query results plus interaction summaries and author metadata, as the block renders them |
| `ListComments` | `targetId` | `{comments, authors}` for one document |
| `ListDiscussions` | `targetId`, `commentId?` | comments grouped into threads, plus discussions that cite the document |
| `ListCommentsByReference` | `targetId` | comments elsewhere that reference the document |
| `ListCommentsByAuthor` | `authorId` | `{comments, authors}` |
| `ListCommentVersions` | `id` | every version of one comment |
| `GetCommentReplyCount` | `id` | a number |
| `ListCitations` | `targetId=hm://…` (flat) | `{citations: [{source, sourceType, sourceContext, sourceBlob, target, targetVersion, isExactVersion, …}]}` |
| `ListChanges` | `targetId=hm://…` (flat) | `{changes: [{id, author, deps, createTime}], latestVersion}` |
| `ListCapabilities` | `targetId=hm://…` (flat) | `{capabilities: [{id, issuer, delegate, account, path, role, label, createTime, …}]}` |
| `ListDocumentCollaborators` | `targetId=hm://…` (flat) | who may write: `{publisherUid, parentCapabilities, grantedCapabilities, grantedMembers, members, accounts}` |
| `InteractionSummary` | `id` | counts of citations, comments, changes and children, per document and per block |
| `ListEvents` | `pageSize?`, `pageToken?`, `filterAuthors?`, `filterEventType?`, `filterResource?`, `currentAccount?`, `order?` (`claimed` or `observed`), `trustedOnly?` | the activity feed, each event resolved to its blob |
| `ListAccounts` | none | `{accounts: [{id, metadata}]}`, every account the site knows |
| `GetCID` | `cid` | `{value}`: any stored blob decoded to DAG-JSON |
| `GetDomain` | `domain`, `forceCheck?` | what the site knows about another site's domain: `{status, registeredAccountUid, peerId, isGateway, lastCheck, …}` |
| `ListDomains` | none | `{domains}` |
| `DiscoveryStatus` | `uid`, `path`, `v?`, `l` (flat) | `{state: 'pending' or 'found' or 'failed', version?, error?}`; each call also nudges discovery |

## Write and pass-through keys

| Key | Body | Answer |
| --- | --- | --- |
| `PublishBlobs` | `{blobs: [{cid?, data}]}` | `{cids}` (superjson) |
| `PrepareDocumentChange` | `{account, path?, baseVersion?, changes, capability?, visibility?}` | `{unsignedChange}` (superjson) |
| `QueryDocuments` | protobuf JSON `{filter?, sort?, pageSize?, pageToken?}` | `{documents, nextPageToken}` (protobuf JSON) |
| `ListDocumentAttributeNames` | `{account?, parentPath?, prefix?, recursive?, pageSize?, pageToken?}` | `{names: [{name, kinds}], nextPageToken}` (protobuf JSON) |
| `ListDocumentAttributeValues` | `{path, kind, account?, prefix?, pageSize?, pageToken?}` | `{values, nextPageToken}` (protobuf JSON) |
| `ListAccounts` (POST) | protobuf JSON `ListAccountsRequest` | protobuf JSON (a second, unwrapped route to the same list) |
| `ListUnreferencedDocuments` | `{account, pageSize?, pageToken?}` | documents no parent links to (protobuf JSON) |

# Resolving a web URL to an hm:// id

Any document URL on a site answers `OPTIONS` with the document's identity in headers. This is how the SDK and the CLI turn a pasted `https://` link into an id without parsing HTML.

```sh
curl -X OPTIONS -I 'https://seed.hyper.media/resources/self-host-seed'
```

```
HTTP/2 200
access-control-expose-headers: X-Hypermedia-Id, X-Hypermedia-Version, X-Hypermedia-Title, X-Hypermedia-Target, X-Hypermedia-Authors, X-Hypermedia-Type
x-hypermedia-id: hm%3A%2F%2Fz6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS%2Fresources%2Fself-host-seed
x-hypermedia-version: bafy2bzacedia6ddwuoefhwcujtlwzwffshysz6peixz7pndfrjchtoqry7qt6
x-hypermedia-title: Self-Host%20a%20Seed%20Website
x-hypermedia-type: Document
x-hypermedia-authors: hm%3A%2F%2Fz6MkfnCSnmstMXTAb6MBXXCj4zdPwZedtRF6YBgYtE5Q8Sov,hm%3A%2F%2Fz6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4,…
```

Values are URL-encoded. `X-Hypermedia-Type` is `Document` or `Comment`; a comment URL adds `X-Hypermedia-Target` with the document it belongs to. The same headers ride on the `GET` of the page, and the page's HTML repeats them as `<meta name="hypermedia_id">` and friends. When the URL cannot be resolved the response is still `200`, with only the CORS headers, so check for `X-Hypermedia-Id` before trusting it. The URL grammar itself is in [URLs](../protocol/urls.md).

# Exports: append .md or .json

A site exports any document by extension on the document segment. There is no `Accept` negotiation.

| URL | Returns |
| --- | --- |
| `/<path>.md`, `/hm/<uid>/<path>.md` | the document as markdown with frontmatter, mentions resolved and query blocks executed; `text/markdown` |
| `/<path>.json` | the `Resource` payload as plain JSON (not superjson) |
| `/<path>.md/:comments`, `/<path>.md/:comments/<uid>/<tsid>` | the discussion, or one comment |
| `/<path>.md/:attributes` | the document's attributes |
| `/<path>.json/:activity`, `…/:activity/comments`, `…/:activity/versions`, `…/:activity/citations` | activity views, paged with `?pageSize=&pageToken=` |
| `/<path>.json/:collaborators`, `/<path>.json/:directory`, `/<path>.json/:all-documents` | collaborators, direct children, the whole subtree |

`?v=<version>` pins a version and `?l` forces latest, as on the page itself. Exports are cached for a minute (`Cache-Control: public, max-age=60`) and carry the `X-Hypermedia-*` headers.

```sh
curl 'https://seed.hyper.media/resources/self-host-seed.md' | head -6
```

```
---
name: Self-Host a Seed Website
cover: ipfs://bafkreie6wls4wzt26vl3smvcc5smulmbostaokyftwmig2ojfpkhbmbee4
---

If you want to publish on your own domain without relying on our service, you are welcome to self-host your site. …
```

# Files and raw blobs: /ipfs/<cid>

`GET /ipfs/<cid>` returns the bytes behind any content id the site's daemon holds or can fetch: an image, a PDF, or a signed blob. Files stored as [UnixFS](https://github.com/ipfs/specs/blob/main/UNIXFS.md) are reassembled; range requests work; `?filename=` sets the download name. The content type is always `application/octet-stream`, so sniff it yourself. Append `.dagjson` to see a structural blob decoded.

```sh
curl 'https://hyper.media/ipfs/bafy2bzacedia6ddwuoefhwcujtlwzwffshysz6peixz7pndfrjchtoqry7qt6.dagjson'
```

```json
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

On hosted sites this path goes straight to the daemon, bypassing the web server, so a bearer cookie does not reach it. A daemon looks for an unknown id on the network for up to a minute before answering `404`, and a blob that no public document, comment or profile links to is not served as public even when stored. [Files](../protocol/files.md) covers this.

# Site services: /hm/api/*

These routes exist so that a site can be a site. Most are called by the Seed app or by the site's own pages; three are useful to integrators.

| Route | Method | Purpose |
| --- | --- | --- |
| `/hm/api/config` | GET | `{registeredAccountUid, peerId, protocolId, signerAccountUid, addrs, hostname, isGateway, notifyServiceHost}`; CORS open, no auth. The one call to learn which space a domain publishes and how to reach its daemon. |
| `/hm/api/auth` | POST, DELETE, OPTIONS | protobuf `AuthenticateRequest` in, bearer cookie out; DELETE clears it |
| `/hm/api/version` | GET | `{web: {commit, branch, date}, daemon: {commit, branch, date}}` |
| `/hm/api/file/<cid>` | GET | streams `/ipfs/<cid>` through the web server, forwarding `Range` and the visitor's cookie |
| `/hm/api/image/<cid>?size=S,M,L,XL` | GET | the image resized to 120, 650, 1600 or 4000 px wide as PNG; GIFs pass through |
| `/hm/api/content-image?space=&path=&version=` | GET | the 1200 by 630 Open Graph image of a document |
| `/hm/api/resource/<uid>/<path>?v=&l` | GET | superjson `Resource`; superseded by `GET /api/Resource?id=` |
| `/hm/api/discover` | POST JSON `{uid, path, version?, media?}` | make the site fetch a document now, blocking until done; `DiscoveryStatus` is the non-blocking form |
| `/hm/api/register` | POST JSON `{registrationSecret, accountUid, peerId, addrs}` | bind a space to this site; the Seed app calls it from the registration link |
| `/hm/api/admin` | POST JSON `{adminSecret, adminAction}` | the multi-tenant control plane of a hosting service; disabled unless the operator sets a secret |
| `/hm/api/site-image` | POST bytes | square-crop an icon to 512 px |
| `/hm/api/document-update` | POST CBOR | legacy: store a change, a ref and an icon; use `PublishBlobs` |
| `/hm/api/delegate-device` | POST CBOR | legacy device delegation; no current caller |

```sh
curl https://hyper.media/hm/api/config
```

```json
{"registeredAccountUid":"z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB","peerId":"12D3KooWEDdEeuY3oHCSKtn1eC7tU9qNWjF9bb8sCtHzpuCjvomQ","protocolId":"/hypermedia/0.9.2","signerAccountUid":"z6MktB9d9djZFYDzrQ8jpgveVpjdBADZDtQUFaU8ygD37YYU","addrs":["/dns4/hyper.media/tcp/56001/p2p/12D3KooWEDdEe…","/dns4/hyper.media/udp/56001/quic-v1/p2p/12D3KooWEDdEe…"],"hostname":"https://hyper.media","isGateway":true,"notifyServiceHost":"https://notify.seed.hyper.media"}
```

Email notification endpoints (`/hm/api/notifications`, `/hm/api/notification-config`, `/hm/api/public-subscribe`) are not part of the web server; they belong to the notify service whose host `/hm/api/config` advertises as `notifyServiceHost`. There is no sitemap, no RSS and no `.well-known` route; `robots.txt` allows everything.

# The desktop bridge differs in two ways

The Seed desktop app serves the same keys on `http://localhost:56004/api/*` for local tools such as the CLI's `space dev` and the bundled agents server. It refuses requests whose `Sec-Fetch-Site` header marks them cross-site, so a web page cannot call it. It also lacks the pass-through special case: `POST /api/QueryDocuments` answers superjson there, and POST `ListAccounts` and `ListUnreferencedDocuments` answer `404`.

# Working with it

## In the Seed app

With Developer Mode on, the app renders a console for every key from the published [rpc](../rpc.md) schemas: pick a key, fill the input in the schema-driven editor, run it against your daemon, and the response is checked against the declared output.

## CLI

The [Seed CLI](./cli.md) is a Seed API client. `seed-cli --server https://example.org document get <id>` sends the `Resource` key to that site; `search`, `query`, `children`, `citations`, `activity`, `account` and `comment list` map onto the read keys above, and every write command signs locally and calls `PublishBlobs`. Pass an `https://` URL as an id and the CLI resolves it with the `OPTIONS` headers and talks to that URL's site.

## SDK

`createSeedClient(baseUrl)` from `@seed-hypermedia/client` gives `client.request(key, input)` with typed inputs and outputs for every key, choosing the encoding and unwrapping the envelope. `client.publish(blobs)` is `PublishBlobs`; `client.publishDocument(input, signer)` runs `PrepareDocumentChange`, signs and publishes. Pass `{headers: {Authorization: 'Bearer …'}}` to authenticate. The [SDK page](./sdk.md) has the builders for changes, refs, comments, capabilities and contacts.

## Agents

Seed Agents read and write hypermedia through this API with delegated keys; their `search`, `query` and `attributes` tools are the `Search`, `Query`/`QueryDocuments` and attribute keys, and their `write` verb ends in `PublishBlobs`. An external agent, such as Claude Code with the seed-cli skill, uses the CLI or `curl` exactly as above. An agent with no key of its own can read everything public; to write, it needs a key and a capability from the space owner, which [building agents](./agents.md) walks through.

# See also

- [Getting started](./getting-started.md), the first requests in fifteen minutes
- [Seed API schemas](../rpc.md), one page per key, and the read models under `rpc/type`
- [Daemon gRPC](./grpc.md), the lower layer every site server calls
- [URLs](../protocol/urls.md), [Blobs](../protocol/blobs.md), [Permissions](../protocol/permissions.md), [Sites](../protocol/sites.md)
- [Self-hosting](./self-hosting.md), for the server that answers these requests
