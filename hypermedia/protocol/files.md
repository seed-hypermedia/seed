---
name: Files
summary: Images, videos and attachments travel as content-addressed IPFS file blocks, linked from documents by ipfs:// URLs and served by every node's /ipfs gateway.
---
A picture in a [document](./documents.md) lives outside the document. It is split into content-addressed blocks and given a [CID](../cid.md), and the document carries only a link `ipfs://<cid>`. The blocks travel over the same [network](./network.md) as everything else, and any Seed node that holds them can serve the file back at `/ipfs/<cid>`. <!-- id:yP2vctFk -->

Seed uses the [IPFS](https://docs.ipfs.tech/concepts/) file model unchanged, with no file [blob](./blobs.md) type of its own. Seed adds one rule: who may fetch a file depends on the documents that link to it. <!-- id:LlqesciI -->

# How it works <!-- id:J9H8DSD- -->

## Files are UnixFS DAGs <!-- id:xEJdFHW5 -->

A file is chunked into pieces of up to 256 KiB. Each piece becomes a **raw** block whose CID is the SHA-256 of its bytes (CIDv1, the `bafkrei…` form). A file that fits in one piece is that one raw block. That is why small icons in [metadata](../metadata.md) look like `ipfs://bafkreie6wls…`. A larger file gets a root node in [DAG-PB](https://ipld.io/docs/codecs/known/dag-pb/) encoding (`bafybei…`), the UnixFS format. The root lists the pieces in order, with up to 174 links per node in a balanced tree. Both the [daemon](../apps/daemon.md) and the [SDK](../build/sdk.md) build the tree with the same parameters (balanced layout, raw leaves, CIDv1, 256 KiB chunks), so the same bytes get the same CID whichever side chunks them. <!-- id:tHJMplbk -->

DAG-PB is compact and carries almost no metadata: a node is a byte payload plus links. This is on purpose. The IPFS blocks of a file hold no filename, MIME type or size. A File [block](./blocks.md) in a document may carry a display name beside the link. The daemon serves the bytes as `application/octet-stream`, and the client detects the type. File data is not signed. Its integrity comes from the hash alone, and its authorship from the signed [blob](../blob.md) that links to it. <!-- id:-mKRWYdr -->

The daemon indexes a DAG-PB node only far enough to record its links (`dagpb/<name>` or `dagpb/chunk`), so that [visibility](./privacy.md) can flow down to the pieces. Raw leaves are stored but never indexed. <!-- id:qE8JFw7Z -->

## Where `ipfs://` links appear <!-- id:mCA330XF -->

<!-- id:HQWPBmY4 -->
- **Blocks**: `Image`, `Video` and `File` blocks hold their content in `link` as `ipfs://<cid>` (see [blocks](./blocks.md)). An image in a [comment](./comments.md) works the same way. <!-- id:zLr6847r -->
- **Document metadata**: `icon`, `cover`, `thumbnail` and `seedExperimentalLogo` are `ipfs://` URLs, and so is a [profile](../profile.md) `icon`. <!-- id:b-PgXim7 -->
- **Schemas**: `schemaDefinition` points at a [schema](../schema/typed-documents.md) blob by `ipfs://<cid>`. That blob is DAG-CBOR and is not a file. It is fetched through the same gateway. <!-- id:Pr8cdxN2 -->

A typed attribute uses the [ipfs-url](../ipfs-url.md) schema type to say "this value is a file reference". <!-- id:VVp7-THI -->

## Visibility follows the link <!-- id:pW39Clyv -->

A file block has no visibility of its own. When it is first stored it is treated as **private**. It becomes public as soon as any public blob links to it, directly or through another DAG-PB node. The indexer passes visibility along every link type into DAG-PB and raw blocks. So a public document's image and all of its chunks are public, and a private document's image stays private. If the only document linking a file is deleted or made private, the file follows. <!-- id:6Buine9d -->

This surprises people: **a file uploaded on its own is not public**. Publishing the blocks stores them, and the uploader can fetch them back. But a gateway in public-only mode answers `404` with "blob … is not public" until a published document, comment or profile references the `ipfs://` URL. This rule stops a Seed node from acting as anonymous public file hosting. Link the file from something public, and it appears. <!-- id:Iuhj83rQ -->

## The `/ipfs` gateway <!-- id:XelAsoKi -->

Every daemon serves files on its HTTP port, and every [site](./sites.md) proxies `/ipfs/*` on its domain straight to its daemon: <!-- id:easwJ69R -->

<!-- id:8oxv9Mb9 -->
| Request <!-- col:f5dl8Z7O --> | Behaviour <!-- col:wItX6-Qx --> <!-- id:ULlbhRwV --> |
| --- | --- |
| `GET /ipfs/<cid>` | Look locally first, then on the network over [Bitswap](./network.md) for up to one minute (`408` on timeout). A UnixFS root is reassembled into the whole file; any other block is returned raw. <!-- id:1trBmp0w --> |
| `GET /ipfs/<cid>?filename=photo.jpg` | Adds `Content-Disposition: attachment; filename="photo.jpg"`. <!-- id:ZvQHYexw --> |
| `Range: bytes=…` | Honoured with `206 Partial Content`. `Accept-Ranges: bytes` is always sent, which lets video seek. <!-- id:F-NzKWDk --> |
| `GET /ipfs/<cid>.dagjson` | Decodes the block with its codec and returns pretty-printed DAG-JSON. This is how you inspect a [change](../change.md), [ref](../ref.md) or comment blob by CID. <!-- id:3AgXw6U5 --> |
| `POST /ipfs/file-upload` | Multipart form field `file`, at most 150 MiB. Chunks the file and answers `201` with the root CID as plain text. <!-- id:uX0TQ8fj --> |
| `POST /ipfs/<cid>` | Store one raw block. The daemon recomputes the multihash and rejects a mismatch with `400`. At most 150 MiB. <!-- id:-vUup8n- --> |

Responses carry `ETag: <cid>` and `Content-Type: application/octet-stream`. The client works out the file's real type. `Cache-Control` is `public, max-age=29030400, immutable` (about 336 days) when the daemon can prove the blob is public, and `private, max-age=29030400, immutable` otherwise, so shared caches and CDNs never keep private content. An `Authorization: Bearer` header from a signed-in web session lets the daemon serve a private file to a reader who may see its [space](./identity.md). <!-- id:-f6HpGkq -->

There are two limitations. First, without the `-public-only` flag a daemon serves any blob it holds to anyone who knows the CID, and both `POST` routes are open to anyone who can reach the port. The Seed app's daemon binds all interfaces, so keep its HTTP port off untrusted networks. Second, on a hosted site the proxy forwards every method on `/ipfs/*` to the daemon, so the upload routes are reachable from the internet. An upload stays private until something public links it, but it still uses disk. As of September 2026 the compose template in this repository does not pass `-public-only` to the site daemon. So a hosted site's gateway serves a private blob to whoever presents its CID. Operators who want the stricter behaviour add the flag; see [self-hosting](../build/self-hosting.md). <!-- id:KSKS52ek -->

Public IPFS gateways such as `ipfs.io` cannot find content published only on Seed. Seed nodes do not advertise blocks to the IPFS DHT (see [Network](./network.md)). An `https://ipfs.io/ipfs/<cid>` link works only for content someone pinned there separately. <!-- id:URxNAB6R -->

## The site's file and image services <!-- id:2HWScTI0 -->

The [web app](../apps/web.md) adds two routes on top of the raw gateway. `GET /hm/api/file/<cid>` streams the daemon's `/ipfs/<cid>` with `Range` forwarded and the visitor's session cookie turned into a bearer token, so private files render for signed-in readers on hosted sites. `GET /hm/api/image/<cid>?size=S|M|L|XL` returns a PNG resized to at most 120, 650, 1600 or 4000 pixels wide (default `M`; GIFs pass through untouched). It caches the result on disk only when the daemon says the source is public. Every icon, cover and inline image on a rendered page goes through the image route. Downloads and videos go through the file route. <!-- id:IFM5pnYg -->

## Uploading <!-- id:xXvAXmF5 -->

There are two ways to get a file into the network. Both produce the same CIDs: <!-- id:14XfNxVD -->
  1. **Ask a daemon to chunk it**: `POST /ipfs/file-upload`. The Seed app does this against its own local daemon for every drag-and-drop, paste and web-import. <!-- id:B5XWNYF7 -->
  2. **Chunk it yourself and publish the blocks**: the SDK's `fileToIpfsBlobs` (one file) or `filesToIpfsBlobs` (several, sharing a block store) returns the root CID and every block with its CID. Hand them to `PublishBlobs` on any site. The web app, the [CLI](../build/cli.md) and [Seed Agents](../agent.md) all use this path, because none of them can reach a daemon's upload route on a hosted site. Send each block with its SHA-256 CID. The daemon hashes a blob published without an explicit CID with BLAKE2b, and that CID would not match the links pointing at it (see [Signed Blobs](./blobs.md)). <!-- id:nCiBW075 -->

A single `PublishBlobs` request has a message-size limit of a few megabytes, so a large file is published in several requests. The agents runtime batches at 3 MiB. The daemon's own upload route accepts up to 150 MiB in one request. <!-- id:ie39jj2a -->

# Worked example <!-- id:gg4WRMYO -->

Alice drops `talk.pdf` (700 KiB) into a document in the Seed app. <!-- id:F7fiJgV_ -->
  1. The app posts the bytes to `http://localhost:56001/ipfs/file-upload`. The daemon chunks them into three raw blocks and one DAG-PB root and answers `201 bafybeigd…`. <!-- id:JHq4lB9t -->
  2. The editor inserts a `File` block with `link: "ipfs://bafybeigd…"` and the name `talk.pdf`. The four blocks now sit in Alice's daemon as private, because nothing public links them yet. <!-- id:P3WsEsPb -->
  3. Alice publishes. The signed [change](../change.md) links the root CID. The indexer marks the root as public, and through its `dagpb/chunk` links, the three pieces too. The publish pushes the change, the [Ref](../ref.md) and the four file blocks to Alice's [site](./sites.md). <!-- id:EvgmAJi0 -->
  4. A reader's browser renders the page and requests `https://alice.example/hm/api/file/bafybeigd…?filename=talk.pdf`. The site's web app proxies to its daemon, which reassembles the PDF and streams it with a public, immutable cache header. <!-- id:4BU2UZDt -->
  5. Bob's Seed app, subscribed to Alice's space, discovers the change on its next wave. The [reconciliation](./network.md) lists the root and pieces among the missing CIDs. Bitswap fetches the DAG-CBOR blobs first and the PDF in the bulk media tier, so Bob's page text appears before the attachment finishes. <!-- id:JW01eMUG -->

Read the raw block back on any node with `curl https://alice.example/ipfs/bafybeigd….dagjson` to see the UnixFS root and its three links. <!-- id:acW0RJ5N -->

# Working with files <!-- id:QngllqZu -->

## In the Seed app <!-- id:N8ueOXW_ -->

Drag a file or image into the editor, paste one, or use the block menu's Image, Video and File blocks. The [Seed app](../apps/desktop.md) uploads to its local daemon and inserts the `ipfs://` link. Space and document settings upload icons, covers and logos the same way. Files render from the local daemon's gateway, so they are available offline once synced. The maximum upload is 150 MiB. The agents memory tab has a "Publish to IPFS" action for a memory file, with the same "not public until linked" caveat. <!-- id:pVqva5gb -->

## CLI <!-- id:ewAMCvnq -->

`seed-cli document create -f page.md` resolves `file://` links in image blocks and in `icon`, `cover` and logo metadata. It chunks each file with the SDK, publishes the blocks with the document, and turns the links into `ipfs://` URLs. `seed-cli profile set --icon ipfs://<cid>` accepts only an already-published CID. `seed-cli document cid <cid>` fetches a block decoded as DAG-JSON through the site's `GetCID`, and `seed-cli blob get ipfs://<cid>` reads a DAG-CBOR blob and checks its signature and schema. There is no standalone upload command. Publish files as part of a document. See the [CLI reference](../build/cli.md). <!-- id:Sj6ighDR -->

## SDK <!-- id:idf4itXS -->

```ts <!-- id:ZrEXBS0J -->
import {createSeedClient, fileToIpfsBlobs} from '@seed-hypermedia/client'

const client = createSeedClient('https://hyper.media')
const {cid, blobs} = await fileToIpfsBlobs(bytes)
await client.publish({blobs: blobs.map((b) => ({cid: b.cid, data: b.data}))})
// use `ipfs://${cid}` in a block's link or in metadata, then publish the document
const {value} = await client.request('GetCID', {cid})
```

`resolveFileLinksInBlocks(nodes, loader)` replaces `file://` links in a block tree with published `ipfs://` links and returns the blobs to publish beside the document. `hasFileLinks(nodes)` tells you whether you need it. For reading, build URLs from the site: `${base}/ipfs/${cid}` for bytes, `${base}/hm/api/image/${cid}?size=L` for a resized image. The [SDK guide](../build/sdk.md) has the full surface. <!-- id:H1C6jndW -->

## Web API <!-- id:g-DnRgBi -->

On any site: `GET /ipfs/<cid>` and `GET /ipfs/<cid>.dagjson` (the daemon's gateway, proxied), `GET /hm/api/file/<cid>`, `GET /hm/api/image/<cid>?size=…`, `GET /api/GetCID?cid=…` (returns `{value}` decoded), and `POST /api/PublishBlobs` with `{blobs: [{cid, data}]}` to store blocks you chunked yourself. On a daemon you control, `POST /ipfs/file-upload` and `POST /ipfs/<cid>` as above. The [web API guide](../build/web-api.md) documents request and response shapes. <!-- id:bUJKCYiG -->

```sh <!-- id:wyv4nL0b -->
curl -F file=@talk.pdf http://localhost:56001/ipfs/file-upload      # → bafybeigd…
curl -o talk.pdf "https://hyper.media/ipfs/bafybeigd…?filename=talk.pdf"
curl https://hyper.media/ipfs/bafy2bzace….dagjson                  # inspect a Change
```

## Agents <!-- id:hutET4mn -->

[Seed Agents](../agent.md) address files with their two verbs. [`read`](../agent/read.md) of `ipfs://<cid>` fetches a file into the agent's memory. For a DAG-CBOR object it returns the decoded value with its signature and schema check. [`write`](../agent/write.md) to `ipfs://` publishes from exactly one source: `options.fromPath` for a memory file, `options.fromAttachment` for a file the user attached to the chat, or a JSON object in `content` (optionally validated against a schema and signed). It needs the agent's `publish` [grant](../agent/grants.md) and returns the CID and `ipfs://` URL. The runtime chunks with the SDK and publishes in 3 MiB batches to the agent's configured site (hosted agents use `https://hyper.media`; the desktop's agent uses the app's daemon). The guides at `~/tools/write/ipfs` and `~/tools/write/documents` spell out the options. Agents follow the same rule as everyone else: an `ipfs://` URL on its own displays nowhere. To show a file in chat, an agent references its memory path (`![caption](~/memory/path.png)`). To publish it for the world, the agent links the URL from a document or comment. External agents using the `seed-cli` skill publish files through `document create -f` as above. See [using Seed from your own agent](../build/agents.md). <!-- id:9ZO5ERaI -->

# See also <!-- id:a6roXza4 -->

- [Network](./network.md): how file blocks travel over Bitswap and why bulk media downloads are throttled. <!-- id:v7qNl9Cx -->
- [Sites](./sites.md): the gateway and image routes every site exposes. <!-- id:R1efbqFv -->
- [Privacy](./privacy.md): the visibility model that files inherit. <!-- id:LvK_E7wX -->
- [Blobs](./blobs.md), [CID](../cid.md), [ipfs-url](../ipfs-url.md): the primitives underneath. <!-- id:ISbJ236E -->
- [Blocks](./blocks.md): the Image, Video and File block types. <!-- id:LL1A1gwR -->
- [Why: the end of broken links](../why/broken-links.md): the reason content addressing is worth the trouble. <!-- id:_tnZQyQC -->
