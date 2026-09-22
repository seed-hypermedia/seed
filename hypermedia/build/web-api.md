---
name: Seed API
summary: The HTTP API every Seed site serves, from the typed request keys under /api to the site services under /hm/api, with real requests and responses.
---
Every Seed [site](../protocol/sites.md) is also an API server. The same [web server](../apps/web.md) that renders `https://hyper.media` answers plain HTTP requests for [documents](../protocol/documents.md), [comments](../protocol/comments.md), search results and [accounts](../protocol/identity.md). It also accepts signed [blobs](../protocol/blobs.md) for publishing. You do not need to run anything to read from the network. A `curl` against any site is enough. <!-- id:PG_qAAxO -->

This page is the reference for that surface. Two families live on a site. The **Seed API** is the typed request surface under `/api/<Key>`, where a key such as `Resource` or `Search` names one request with a declared input and output. The **site services** are the fixed routes under `/hm/api/*` that a site needs to be a site: its configuration, authentication, files, images, registration. The [SDK](./sdk.md), the [CLI](./cli.md) and [Seed Agents](../agent.md) all speak the Seed API. A few of the site services matter to integrators too. <!-- id:zREzItlG -->

# Base URLs <!-- id:LnGtRApA -->

A site's origin is the base URL. The key follows `/api/`, and the input rides in the query string for reads or in the body for writes. <!-- id:SKfAIpDH -->

<!-- id:j10jlAsJ -->
| Base URL <!-- col:0E3x8EW3 --> | What answers <!-- col:iQc6xNPD --> | Notes <!-- col:ATW6I4iv --> <!-- id:5AnvSk0q --> |
| --- | --- | --- |
| `https://hyper.media` | the public [gateway](../protocol/sites.md) | serves every public account under `/hm/<uid>/…`; the SDK and CLI default <!-- id:W4qF2a7R --> |
| `https://<any site>` | that site's web server | same handlers; the site's daemon holds its own space plus whatever it has synced <!-- id:FjKnX6bN --> |
| `http://localhost:56004` | the Seed desktop app | the app's local bridge, serving the same keys against your own daemon; `58004` in a dev build <!-- id:5joMHJAx --> |
| `http://localhost:3000` | a Seed web app you run yourself | `PORT` in [self-hosting](./self-hosting.md) <!-- id:WPC8HpH5 --> |

The gateway answers for accounts it knows about. A site's own [space](../protocol/identity.md) is always there. Other accounts are there when the site has [synced](../protocol/network.md) them. If a resource is unknown, the `Resource` key answers `not-found` in the payload and the site starts [discovering](../protocol/network.md) it in the background. See `DiscoveryStatus` below. <!-- id:vc20YAVP -->

# Calling the Seed API <!-- id:G9-O8KVO -->

## Reads are GET requests <!-- id:Lg4Vwli- -->

Read keys are `GET /api/<Key>?…`. The query string is the key's input, encoded in one of three ways. The SDK picks the right one for you. When you hand-write requests you need to know which applies. <!-- id:4fKeixR6 -->

<!-- id:PYbOR29L -->
| Encoding <!-- col:8d7RNRGm --> | Which keys <!-- col:r6uO5sNy --> | How the input travels <!-- col:2YpkRZOs --> <!-- id:hWc01esA --> |
| --- | --- | --- |
| flat params | `Account`, `Resource`, `ResourceMetadata`, `ListCitations`, `ListChanges`, `ListCapabilities`, `ListDocumentCollaborators`, `DiscoveryStatus` | human-readable keys: `?id=hm://…`, `?targetId=hm://…`, `?uid=…&path=…` <!-- id:mTuGEyxF --> |
| JSON values | every other key whose input is an object | each top-level field is one query parameter; primitives as-is, nested objects and arrays as JSON strings (URL-encoded); the server parses each value as JSON and keeps the raw string if that fails <!-- id:ggI_zHGT --> |
| `__value` | keys whose input is a bare string: `Comment`, `AccountContacts`, `SubjectContacts` | `?__value=<the string>` <!-- id:SsOnHG-A --> |

The simplest read is a document by its `hm://` id. <!-- id:3wwpJBv4 -->

```sh <!-- id:4dnXPiW6 -->
curl 'https://hyper.media/api/Resource?id=hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed'
```

```json <!-- id:L8pIo4ck -->
{"json":{"type":"document","id":{"id":"hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed","uid":"z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS","path":["resources","self-host-seed"],"version":null,"latest":true,…},"document":{"content":[{"children":[],"block":{"type":"Paragraph","id":"OtLkse-T","text":"If you want to publish on your own domain…","annotations":[],"attributes":{},"link":""}},…],"metadata":{"name":"Self-Host a Seed Website","cover":"ipfs://bafkreie6…"},"version":"bafy2bzacedia6…","genesis":"bafy2bzacedvbz…","authors":["z6MkfnCSnmst…"],…}}}
```

An account is read by its uid. The answer is the account's home document [metadata](../metadata.md). <!-- id:PbIXATv5 -->

```sh <!-- id:9072WvFS -->
curl 'https://hyper.media/api/Account?id=z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS'
```

```json <!-- id:XpNbdC5- -->
{"json":{"type":"account","id":{"id":"hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS","uid":"z6Mko5np…","path":[],"version":"bafyreigjdxq…"},"metadata":{"name":"Seed Hypermedia","icon":"ipfs://bafkreihpk5…","siteUrl":"https://seed.hyper.media","contentWidth":"L",…}},"meta":{"values":{"metadata.summary":["undefined"]}}}
```

A search takes JSON values. `query` is a plain string, and a number stays a number. <!-- id:MjULFbqf -->

```sh <!-- id:JNgWi_qv -->
curl 'https://hyper.media/api/Search?query=hypermedia&pageSize=2'
```

```json <!-- id:sC8rmhLr -->
{"json":{"entities":[{"id":{"id":"hm://z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB","uid":"z6MkfzKM…","path":[],"version":"bafyreienub…","latest":true},"title":"Hypermedia","icon":"ipfs://bafkreifcj…","parentNames":[],"versionTime":"6/8/2026, 11:57:06 PM","searchQuery":"hypermedia","type":"document"},…],"searchQuery":"hypermedia","nextPageToken":"…"}}
```

A key with an object input, such as `ListComments`, takes the object as a JSON string in one parameter. The SDK writes `?targetId=%7B%22uid%22%3A%22z6Mk…%22%2C%22path%22%3A%5B%22resources%22%5D%7D`. It is easier to let the SDK or the CLI build this than to write it by hand. <!-- id:84VAJ8Lp -->

## Writes are POST requests with a CBOR body <!-- id:cZ4aS1oa -->

Write keys are `POST /api/<Key>` with the input encoded as [DAG-CBOR](https://ipld.io/specs/codecs/dag-cbor/spec/) and `Content-Type: application/cbor`. The server does not check the content type, but the body must decode as CBOR. Two write keys matter. A handful of listing keys also use POST. <!-- id:_6g4RJM9 -->

`PublishBlobs` is how anything gets onto the network. Its input is `{blobs: [{cid?, data}]}`, where `data` is the bytes of a signed blob and `cid` is that blob's [content id](../protocol/blobs.md). The server stores the blobs in the site's [daemon](../apps/daemon.md), which verifies the signature of every structural blob it recognises and indexes it. The output is `{cids: [...]}`. <!-- id:sHxLmVqD -->

Give every blob its `cid`. When you omit it, the daemon computes the id with its own default hash, [BLAKE2b](https://www.blake2.net/), while the SDK computes SHA-256 ids. A blob that another blob points at by id must therefore carry the SHA-256 id you computed when you signed it, or the link will not resolve. [Blobs](../protocol/blobs.md) explains the two hashes. <!-- id:tB-z7jWC -->

`PrepareDocumentChange` asks the daemon to build an unsigned [Change](../change.md) for you from a list of edit operations, so you do not have to compute the change DAG yourself. The input is `{account, path?, baseVersion?, changes: [{op: {case, value}}], capability?, visibility?}`, the output `{unsignedChange: bytes}`. You sign the bytes and publish the result with `PublishBlobs`. The SDK does the whole sequence in `publishDocument`. <!-- id:Ddy9g12l -->

The remaining POST keys, `QueryDocuments`, `ListDocumentAttributeNames`, `ListDocumentAttributeValues`, `ListAccounts` and `ListUnreferencedDocuments`, are pass-throughs to the daemon's own request messages. Their body is the CBOR encoding of the protobuf JSON form of the request, with lowerCamelCase field names and enum names as strings, and they answer with plain protobuf JSON. They do not use the envelope described next. `QueryDocuments` is the attribute query surface. Its filter grammar is in [query grammar](./query-grammar.md). <!-- id:pJJ84D3r -->

## Two response envelopes <!-- id:vSrQYlzb -->

Every read key and the two publishing keys answer `200` with a JSON body wrapped by [superjson](https://github.com/flightcontrolhq/superjson): `{"json": <output>, "meta"?: …}`. The `meta` member appears when the output holds a Date, a bigint or an explicit `undefined`, as in the `Account` response above. Unwrap by taking `json`, or let superjson restore the types for you. The pass-through keys answer with the daemon's protobuf JSON unwrapped. The SDK tells the two apart by looking for a top-level `json` member. <!-- id:TRapHO1p -->

Not-found is never an HTTP status. `Resource` answers one of six shapes in the payload: `document`, `comment`, [`redirect`](../protocol/documents.md) (with `redirectTarget` and `republish`), `not-found`, [`tombstone`](../protocol/documents.md) or `error`. Check the shape in the payload. <!-- id:cbJ9yn8L -->

## Errors <!-- id:MucnXO4Q -->

<!-- id:q1KRsdqE -->
| Status <!-- col:qt3TgdxM --> | When <!-- col:tIw7oMiu --> <!-- id:E7MxFn1H --> |
| --- | --- |
| `400` | no key in the path; a `PublishBlobs` or `PrepareDocumentChange` body that decodes but fails input validation (the message names the field) <!-- id:1acZGveQ --> |
| `404` | an unknown key; the body is `{"error":"Unknown query key: <Key>"}` or `Unknown action key` <!-- id:YshHOajv --> |
| `500` | anything the handler threw, including daemon errors, GET inputs that fail validation and POST bodies that are not valid CBOR; the body is `{"error": <message>}` <!-- id:zWI2Rf98 --> |
| `204` | `OPTIONS` preflight <!-- id:KVZ87mM4 --> |

```sh <!-- id:g3vtBvtr -->
curl -w ' [%{http_code}]' 'https://hyper.media/api/Nope'
```

``` <!-- id:P0BSwBpX -->
{"error":"Unknown query key: Nope"} [404]
```

## Headers, CORS and caching <!-- id:vDyYM78s -->

Every Seed API response carries these headers. <!-- id:igpi0jsI -->

``` <!-- id:1z6tHlY8 -->
content-type: application/json; charset=utf-8
cache-control: private, no-store
access-control-allow-origin: *
access-control-allow-methods: GET, POST, OPTIONS
access-control-allow-headers: Content-Type, Authorization
```

Any web page may call the API cross-origin. The server never sends `Access-Control-Allow-Credentials`, so a cross-origin browser call cannot use the site's auth cookie. Send an `Authorization` header instead. Nothing is cached, which is right for a view that depends on who asks. <!-- id:e6NVqJvE -->

## Authentication <!-- id:PE1rZYiq -->

Reading public content needs nothing. Authentication matters in two cases: reading content the site holds as [private](../protocol/privacy.md), and writing on behalf of a signed-in visitor through `PrepareDocumentChange`. In both, the site forwards a **daemon bearer token** to its daemon, and the daemon decides. <!-- id:G1AlITFn -->

A token is proof that you hold an account key. `POST /hm/api/auth` takes a binary protobuf `AuthenticateRequest {account, timestamp, signature}`, where the signature covers an ephemeral [capability](../capability.md) naming the site daemon's [peer](../protocol/network.md) id as audience, and the timestamp must be within five minutes of the daemon's clock. The daemon mints a token that lives thirty days, and the web server sets it as an `httpOnly` cookie named `__Host-HM-Auth-Token` (`HM-Auth-Token` outside production). The web app does this for you after "Sign in with Seed". See [sign-in](./sign-in.md). <!-- id:k12eBpwS -->

For a script or an agent, pass the token yourself: `Authorization: Bearer <token>` on any `/api/*` request. An explicit header wins over the cookie and is forwarded verbatim to the daemon. Two limits apply. A daemon only issues tokens for [principals](../principal.md) it has already seen in a signed blob, so a brand-new [key](./keys.md) must publish something first. A token cannot be revoked on its own. Only the daemon operator can invalidate all of them at once. <!-- id:XpQTULPo -->

Writing does not need a token. Authority to write is in the blob itself: a [Ref](../ref.md) signed by the space owner, or by a key that holds a [capability](../protocol/permissions.md) from the owner, is accepted from anyone who submits it. A comment signed by any key is accepted on any public document. <!-- id:zuFFDx36 -->

## Discovering the API <!-- id:vLI3LaFn -->

`GET /api/schema` lists every key with its method and path. `GET /api/schema?key=<Key>` returns one key's input and output as [JSON Schema](https://json-schema.org/), along with how the input is encoded. <!-- id:XAMMmRQi -->

```sh <!-- id:fWwovZrb -->
curl 'https://hyper.media/api/schema?key=Resource'
```

```json <!-- id:m7w91SJy -->
{"key":"Resource","kind":"query","method":"GET","path":"/api/Resource","inputEncoding":"query-string","outputEncoding":"application/json","outputSerialization":"superjson","usesParamMapping":true,"inputSchema":{"$ref":"#/definitions/ResourceInput","definitions":{"ResourceInput":{"type":"object","properties":{"id":{"type":"string"},"uid":{"type":"string"},"path":{"anyOf":[{"type":"array","items":{"type":"string"}},{"type":"null"}]},"version":{"type":["string","null"]},…}}}},"outputSchema":{…}}
```

`?kind=query` or `?kind=action` filters the list. The list can miss the pass-through keys. The 2026.9.9 release on `hyper.media` lists only `PublishBlobs` and `PrepareDocumentChange` as actions. Newer builds also list `QueryDocuments` and the two attribute keys, but mark them `outputSerialization: superjson`. Those keys answer plain protobuf JSON. <!-- id:CbwEqw_x -->

# The keys <!-- id:ShqVU2du -->

Inputs are given as the fields you send; read the exact shapes from `GET /api/schema?key=`. `id`-like inputs are an unpacked [hm id](../protocol/urls.md) `{uid, path, version?, latest?, blockRef?}`. In flat encoding you send the packed `hm://` string. <!-- id:_aU1Hc4g -->

## Read keys <!-- id:WwgnL4TX -->

<!-- id:dAaxflls -->
| Key <!-- col:ktccJGmt --> | Input <!-- col:hzfmfPn0 --> | Output <!-- col:s9sNXRDF --> <!-- id:jJPdlkpt --> |
| --- | --- | --- |
| `Resource` | `id=hm://…` (flat) | the resource: `document`, `comment`, `redirect`, `not-found`, `tombstone` or `error` <!-- id:N9bDfeT- --> |
| `ResourceMetadata` | `id=hm://…` (flat) | `{id, metadata, hasSite?}` for a document, without its body <!-- id:9y5l3nPH --> |
| `Account` | `id=<uid>` (flat) | `{type:'account', id, metadata, hasSite?}` or `{type:'account-not-found', uid}`; follows aliases <!-- id:dchU9rPK --> |
| `Comment` | `__value=<author>/<tsid>` | one comment <!-- id:vXz-5PWl --> |
| `AccountContacts` | `__value=<uid>` | the contacts an account has published <!-- id:KnW5sWq1 --> |
| `SubjectContacts` | `__value=<uid>` | the contacts that name an account as subject <!-- id:PT_6MAda --> |
| `Search` | `query`, `accountUid?`, `searchType?`, `pageSize?`, `pageToken?`, `iriFilter?`, `contentTypeFilter?`, `entityKindFilter?`, `perspectiveAccountUid?`, `contextSize?`, `includeBody?` | `{entities: [{id, title, icon, parentNames, type, versionTime?, commentId?}], searchQuery, nextPageToken}` <!-- id:ow7z1JG0 --> |
| `MentionCandidates` | `mode` (`account` or `document`), `query`, `perspectiveAccountUid?`, `siteUid?`, `documentId?`, `seedIds?` | up to 100 candidates for an `@` mention <!-- id:vnXwY3sq --> |
| `Query` | `includes: [{space, path?, mode: 'Children' or 'AllDescendants'}]`, `sort?`, `limit?` | `{in, results: DocumentInfo[], mode?}` or `null`; the same shape a Query block embeds <!-- id:G5vqSMth --> |
| `QueryBlock` | `{query}` | the query results plus interaction summaries and author metadata, as the block renders them <!-- id:toYw2iFJ --> |
| `ListComments` | `targetId` | `{comments, authors}` for one document <!-- id:lWprdM77 --> |
| `ListDiscussions` | `targetId`, `commentId?` | comments grouped into threads, plus discussions that cite the document <!-- id:Atpoi3Yk --> |
| `ListCommentsByReference` | `targetId` | comments elsewhere that reference the document <!-- id:bqidcjBi --> |
| `ListCommentsByAuthor` | `authorId` | `{comments, authors}` <!-- id:iC_zxkdR --> |
| `ListCommentVersions` | `id` | every version of one comment <!-- id:CpA7DumD --> |
| `GetCommentReplyCount` | `id` | a number <!-- id:ha9EEOu- --> |
| `ListCitations` | `targetId=hm://…` (flat) | `{citations: [{source, sourceType, sourceContext, sourceBlob, target, targetVersion, isExactVersion, …}]}` <!-- id:sSAuFLqF --> |
| `ListChanges` | `targetId=hm://…` (flat) | `{changes: [{id, author, deps, createTime}], latestVersion}` <!-- id:U8UVY2RY --> |
| `ListCapabilities` | `targetId=hm://…` (flat) | `{capabilities: [{id, issuer, delegate, account, path, role, label, createTime, …}]}` <!-- id:jQJtdBzq --> |
| `ListDocumentCollaborators` | `targetId=hm://…` (flat) | who may write: `{publisherUid, parentCapabilities, grantedCapabilities, grantedMembers, members, accounts}` <!-- id:vxpQ7TDU --> |
| `InteractionSummary` | `id` | counts of citations, comments, changes and children, per document and per block <!-- id:uAxO9bNZ --> |
| `ListEvents` | `pageSize?`, `pageToken?`, `filterAuthors?`, `filterEventType?`, `filterResource?`, `currentAccount?`, `order?` (`claimed` or `observed`), `trustedOnly?` | the activity feed, each event resolved to its blob <!-- id:2bVETEGC --> |
| `ListAccounts` | none | `{accounts: [{id, metadata}]}`, every account the site knows <!-- id:-OGEaR9M --> |
| `GetCID` | `cid` | `{value}`: any stored blob decoded to DAG-JSON <!-- id:sw0poXnz --> |
| `GetDomain` | `domain`, `forceCheck?` | what the site knows about another site's domain: `{status, registeredAccountUid, peerId, isGateway, lastCheck, …}` <!-- id:efebBtyc --> |
| `ListDomains` | none | `{domains}` <!-- id:HYHrFT23 --> |
| `DiscoveryStatus` | `uid`, `path`, `v?`, `l?` (flat) | `{state: 'pending' or 'found' or 'failed', version?, error?}`; each call also nudges discovery <!-- id:TlkACTHq --> |

## Write and pass-through keys <!-- id:8rcbMJ13 -->

<!-- id:Jp839-zr -->
| Key <!-- col:HkNzp_eT --> | Body <!-- col:FuQ6sLMa --> | Answer <!-- col:apvciPeT --> <!-- id:zfCp5KOv --> |
| --- | --- | --- |
| `PublishBlobs` | `{blobs: [{cid?, data}]}` | `{cids}` (superjson) <!-- id:wHel8dLf --> |
| `PrepareDocumentChange` | `{account, path?, baseVersion?, changes, capability?, visibility?}` | `{unsignedChange}` (superjson) <!-- id:_r1x403C --> |
| `QueryDocuments` | protobuf JSON `{filter?, sort?, pageSize?, pageToken?}` | `{documents, nextPageToken}` (protobuf JSON) <!-- id:aTMvEXYt --> |
| `ListDocumentAttributeNames` | `{account?, parentPath?, prefix?, recursive?, pageSize?, pageToken?}` | `{names: [{name, kinds}], nextPageToken}` (protobuf JSON) <!-- id:FBxseaaQ --> |
| `ListDocumentAttributeValues` | `{path, kind, account?, prefix?, pageSize?, pageToken?}` | `{values, nextPageToken}` (protobuf JSON) <!-- id:fI8YE1nN --> |
| `ListAccounts` (POST) | protobuf JSON `ListAccountsRequest` | protobuf JSON (a second, unwrapped route to the same list) <!-- id:pPA3hs9C --> |
| `ListUnreferencedDocuments` | `{account, pageSize?, pageToken?}` | documents no parent links to (protobuf JSON). The daemon has it switched off for now, so it answers `500` with `unreferenced documents are temporarily disabled` <!-- id:GP7qJ0BI --> |

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

# Site services: /hm/api/ <!-- id:t5vOz0nD -->

These routes exist so that a site can be a site. Most are called by the Seed app or by the site's own pages. Three are useful to integrators. <!-- id:4deSzBOW -->

<!-- id:PKELLSlU -->
| Route <!-- col:UhI8xWLl --> | Method <!-- col:mznQCc-8 --> | Purpose <!-- col:tXMDDkZA --> <!-- id:17H0puft --> |
| --- | --- | --- |
| `/hm/api/config` | GET | `{registeredAccountUid, peerId, protocolId, signerAccountUid, addrs, hostname, isGateway, notifyServiceHost}`; CORS open, no auth. The one call to learn which space a domain publishes and how to reach its daemon. <!-- id:EdR0gB7w --> |
| `/hm/api/auth` | POST, DELETE, OPTIONS | protobuf `AuthenticateRequest` in, bearer cookie out; DELETE clears it <!-- id:DylsGsu- --> |
| `/hm/api/version` | GET | `{web: {commit, branch, date}, daemon: {commit, branch, date}}` <!-- id:RTaB8Y2L --> |
| `/hm/api/file/<cid>` | GET | streams `/ipfs/<cid>` through the web server, forwarding `Range` and the visitor's cookie <!-- id:inUY6yej --> |
| `/hm/api/image/<cid>?size=S,M,L,XL` | GET | the image resized to 120, 650, 1600 or 4000 px wide as PNG; GIFs pass through <!-- id:1V1AxxRB --> |
| `/hm/api/content-image?space=&path=&version=` | GET | the 1200 by 630 Open Graph image of a document <!-- id:6F0-xMQC --> |
| `/hm/api/resource/<uid>/<path>?v=&l` | GET | superjson `Resource`; superseded by `GET /api/Resource?id=` <!-- id:D_p52ly6 --> |
| `/hm/api/discover` | POST JSON `{uid, path, version?, media?}` | make the site fetch a document now, blocking until done; `DiscoveryStatus` is the non-blocking form <!-- id:B6aHtARB --> |
| `/hm/api/register` | POST JSON `{registrationSecret, accountUid, peerId, addrs}` | bind a space to this site; the Seed app calls it from the registration link <!-- id:L-bWaPhS --> |
| `/hm/api/admin` | POST JSON `{adminSecret, adminAction}` | the multi-tenant control plane of a hosting service; disabled unless the operator sets a secret <!-- id:zvYNQVy0 --> |
| `/hm/api/site-image` | POST bytes | square-crop an icon to 512 px <!-- id:RGnDHd0E --> |
| `/hm/api/document-update` | POST CBOR | legacy: store a change, a ref and an icon; use `PublishBlobs` <!-- id:pFA2fmSk --> |
| `/hm/api/delegate-device` | POST CBOR | legacy device delegation; no current caller <!-- id:K4qFEOml --> |

```sh <!-- id:Q9pBqSvo -->
curl https://hyper.media/hm/api/config
```

```json <!-- id:9sTFtDRg -->
{"registeredAccountUid":"z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB","peerId":"12D3KooWEDdEeuY3oHCSKtn1eC7tU9qNWjF9bb8sCtHzpuCjvomQ","protocolId":"/hypermedia/0.9.2","signerAccountUid":"z6MktB9d9djZFYDzrQ8jpgveVpjdBADZDtQUFaU8ygD37YYU","addrs":["/dns4/hyper.media/tcp/56001/p2p/12D3KooWEDdEe…","/dns4/hyper.media/udp/56001/quic-v1/p2p/12D3KooWEDdEe…"],"hostname":"https://hyper.media","isGateway":true,"notifyServiceHost":"https://notify.seed.hyper.media"}
```

Email notification endpoints (`/hm/api/notifications`, `/hm/api/notification-config`, `/hm/api/public-subscribe`) are not part of the web server. They belong to the [notify service](../apps/notify.md), whose host `/hm/api/config` advertises as `notifyServiceHost`. There is no sitemap, no RSS and no `.well-known` route. `robots.txt` allows everything. <!-- id:lCPdAtXB -->

# The desktop bridge differs in two ways <!-- id:407ymi_o -->

The Seed desktop app serves the same keys on `http://localhost:56004/api/*` for local tools such as the CLI's `space dev` and the bundled agents server. It refuses requests whose `Sec-Fetch-Site` header marks them cross-site, so a web page cannot call it. It also lacks the pass-through special case. `POST /api/QueryDocuments` answers superjson there, and POST `ListAccounts` and `ListUnreferencedDocuments` answer `404`. <!-- id:iCa7w_8g -->

# Working with it <!-- id:XHbbjtMm -->

## CLI <!-- id:h86DDJAy -->

The [Seed CLI](./cli.md) is a Seed API client. `seed-cli --server https://example.org document get <id>` sends the `Resource` key to that site. `search`, `query`, `children`, `citations`, `activity`, `account` and `comment list` map onto the read keys above, and every write command signs locally and calls `PublishBlobs`. Pass an `https://` URL as an id and the CLI resolves it with the `OPTIONS` headers and talks to that URL's site. <!-- id:duc_NHhT -->

## SDK <!-- id:_QAbJ2eG -->

`createSeedClient(baseUrl)` from `@seed-hypermedia/client` gives `client.request(key, input)` with typed inputs and outputs for every key, choosing the encoding and unwrapping the envelope. `client.publish(blobs)` is `PublishBlobs`. `client.publishDocument(input, signer)` runs `PrepareDocumentChange`, signs and publishes. Pass `{headers: {Authorization: 'Bearer …'}}` to authenticate. The [SDK page](./sdk.md) has the builders for changes, refs, comments, capabilities and contacts. <!-- id:_YvKJwOZ -->

## Agents <!-- id:_2P6hGy6 -->

Seed Agents read and write hypermedia through this API with delegated keys. Their `search`, `query` and `attributes` tools map to the `Search`, `Query`/`QueryDocuments` and attribute keys, and their [`write`](../agent/write.md) verb ends in `PublishBlobs`. An external agent, such as Claude Code with the seed-cli skill, uses the CLI or `curl` exactly as above. An agent with no key of its own can read everything public. To write, it needs a key and a capability from the space owner, which [Using Seed from your own agent](./agents.md) walks through. <!-- id:vvHfEBMh -->

# See also <!-- id:ueo6GDk6 -->

- [Getting started](./getting-started.md), the first requests in fifteen minutes <!-- id:hmb_VSSC -->
- [Daemon gRPC](./grpc.md), the lower layer every site server calls <!-- id:kThxPzkz -->
- [URLs](../protocol/urls.md), [Blobs](../protocol/blobs.md), [Permissions](../protocol/permissions.md), [Sites](../protocol/sites.md) <!-- id:rQRGkMw2 -->
- [Self-hosting](./self-hosting.md), for the server that answers these requests <!-- id:t0ys6KsO -->
