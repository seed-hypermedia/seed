---
name: Files
summary: Images, videos and attachments travel as content-addressed IPFS file blocks, linked from documents by ipfs:// URLs and served by every node at /ipfs/<cid>.
---
A picture in a [document](./documents.md) lives outside the document. It is split into content-addressed blocks and given a [CID](../cid.md), and the document carries only a link `ipfs://<cid>`. The blocks travel over the same [network](./network.md) as everything else, and any Seed node that holds them can serve the file back at `/ipfs/<cid>`. <!-- id:yP2vctFk -->

Seed uses the [IPFS](https://docs.ipfs.tech/concepts/) file model unchanged, with no file [blob](./blobs.md) type of its own. Seed adds one rule: who may fetch a file depends on the documents that link to it. <!-- id:LlqesciI -->

# How it works <!-- id:J9H8DSD- -->

## Files are UnixFS DAGs <!-- id:xEJdFHW5 -->

A file is chunked into pieces of up to 256 KiB. Each piece becomes a **raw** block whose CID is the SHA-256 of its bytes (CIDv1, the `bafkrei…` form). A file that fits in one piece is that one raw block. That is why small icons in [metadata](../metadata.md) look like `ipfs://bafkreie6wls…`. A larger file gets a root node in [DAG-PB](https://ipld.io/docs/codecs/known/dag-pb/) encoding (`bafybei…`), the UnixFS format. The root lists the pieces in order, with up to 174 links per node in a balanced tree. Both the [daemon](../software/daemon.md) and the [SDK](../build/sdk.md) build the tree with the same parameters (balanced layout, raw leaves, CIDv1, 256 KiB chunks), so the same bytes get the same CID whichever side chunks them. <!-- id:tHJMplbk -->

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

This surprises people: **a file uploaded on its own is not public**. Publishing the blocks stores them, and the uploader's local daemon can fetch them back. A gateway in server mode denies anonymous reads until a published document, comment or profile references the `ipfs://` URL; authorized bearer callers can still read private files. This rule stops a Seed node from acting as anonymous public file hosting. Link the file from something public, and it appears. <!-- id:Iuhj83rQ -->

## The `/ipfs` gateway <!-- id:XelAsoKi -->

Every daemon serves files on its HTTP port at `GET /ipfs/<cid>`, and every [site](./sites.md) proxies `/ipfs/*` on its domain straight to its daemon. The daemon looks locally first, then on the network over [Bitswap](./network.md). A UnixFS root is reassembled into the whole file, and range requests work, which lets video seek. The [web app](../software/web.md) adds `/hm/api/file/<cid>` and `/hm/api/image/<cid>` on top, so signed-in readers can see private files and pages get resized images. The [web API guide](../build/web-api.md) lists the routes, parameters and headers.

A daemon in its default mode admits only local callers, and a daemon in server mode filters anonymous reads of private content; see [Integrity](./integrity.md). A site's proxy forwards uploads on `/ipfs/*` too. An upload stays private until something public links it, but it still uses disk; see [self-hosting](../operate/self-hosting.md).

Public IPFS gateways such as `ipfs.io` cannot find content published only on Seed. Seed nodes do not advertise blocks to the IPFS DHT (see [Network](./network.md)). An `https://ipfs.io/ipfs/<cid>` link works only for content someone pinned there separately. <!-- id:URxNAB6R -->

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

- **Seed app.** Drag a file or image into the editor, paste one, or use the Image, Video and File blocks. The [Seed app](../software/desktop.md) uploads to its local daemon and inserts the `ipfs://` link. The maximum upload is 150 MiB.
- **CLI.** `seed-cli document create -f page.md` resolves `file://` links in image blocks and in `icon`, `cover` and logo metadata, publishes the file blocks with the document, and turns the links into `ipfs://` URLs. There is no standalone upload command. See the [CLI reference](../build/cli.md).
- **SDK.** `fileToIpfsBlobs(bytes)` returns the root CID and the blocks, and `client.publish({blobs})` stores them. `resolveFileLinksInBlocks(nodes, loader)` does the same for every `file://` link in a block tree. See the [SDK guide](../build/sdk.md).
- **Web API.** `GET /ipfs/<cid>` reads a file and `POST /api/PublishBlobs` stores blocks you chunked yourself. See the [web API guide](../build/web-api.md).
- **Agents.** [`read`](../agent/read.md) of `ipfs://<cid>` fetches a file into the agent's memory, and [`write`](../agent/write.md) to `ipfs://` publishes one from a memory file, a chat attachment or a JSON object. It needs the agent's `publish` [grant](../agent/grants.md). An `ipfs://` URL on its own displays nowhere: the agent links it from a document or comment to publish it. See [using Seed from your own agent](../build/agents.md).

# See also <!-- id:a6roXza4 -->

- [Network](./network.md): how file blocks travel over Bitswap and why bulk media downloads are throttled. <!-- id:v7qNl9Cx -->
- [Sites](./sites.md): the server that proxies `/ipfs/*` for a space. <!-- id:R1efbqFv -->
- [Web API](../build/web-api.md): the `/ipfs` routes and the site's file and image services.
- [Privacy](./privacy.md): the visibility model that files inherit. <!-- id:LvK_E7wX -->
- [Blobs](./blobs.md), [CID](../cid.md), [ipfs-url](../ipfs-url.md): the primitives underneath. <!-- id:ISbJ236E -->
- [Blocks](./blocks.md): the Image, Video and File block types. <!-- id:LL1A1gwR -->
- [Why: the end of broken links](../why/broken-links.md): the reason content addressing is worth the trouble. <!-- id:_tnZQyQC -->
