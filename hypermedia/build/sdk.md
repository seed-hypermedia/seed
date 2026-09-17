---
name: SDK
summary: The @seed-hypermedia/client package reference, from installing it and reading a document to building, signing and publishing your own blobs.
---
The SDK is the TypeScript package `@seed-hypermedia/client`. It is the one implementation of the Hypermedia data formats that the [Seed app](../apps/desktop.md), the [Seed web app](../apps/web.md), the [Seed CLI](./cli.md), the [vault](../apps/vault.md) and [Seed Agents](../agent.md) all share. It covers how a [blob](../protocol/blobs.md) is encoded and signed, how a [document](../protocol/documents.md) [change](../change.md) is built, how markdown round-trips, and how a [schema](../schema.md) is resolved. Nothing in it needs React, a [daemon](../apps/daemon.md) or a network beyond plain `fetch`, so it runs in Node, Bun, browsers and React Native. <!-- id:GKERgZSz -->

This page is the reference. If you have never published anything yet, start with [Getting started](./getting-started.md). If you only need to read public data, the [Seed API](./web-api.md) over plain HTTP may be enough. <!-- id:uMFhMR5F -->

# Install and import <!-- id:abDQXJxO -->

```sh <!-- id:4E34K789 -->
npm install @seed-hypermedia/client zod@^3
```

<!-- id:Y-oJftG2 -->
| Fact <!-- col:FQJZD8im --> | Value <!-- col:rd5Y0WyZ --> <!-- id:v6ok3yak --> |
| --- | --- |
| Package | `@seed-hypermedia/client` on npm, ESM only <!-- id:1mgZ2PJd --> |
| Peer dependencies | `zod` 3.x (required; zod 4 breaks the package at import time), `pdfjs-dist` (optional, only for `pdfToBlocks`) <!-- id:90a1wpUr --> |
| Entry points | the root barrel, plus every module as a subpath: `@seed-hypermedia/client/<module>` <!-- id:0gOFrB-S --> |
| Runtime requirements | `fetch`; WebCrypto only for the browser sign-in module <!-- id:pjILNryS --> |
| Versioning | CI publishes a new patch on every push to `main` that touches the package, so the npm version is always ahead of the repository's `package.json`. Pin the version you tested against <!-- id:ubGO5w0Y --> |

The root barrel exports the client, the blob builders, the markdown dialect, the id helpers and the document-state helpers. Some modules are subpath-only and are imported by name: `auth` (browser sign-in), `hmauth` (the sign-in protocol), `blobs` (key pairs, profiles, low-level capability and signing primitives), `signed-blob` (user-defined signed blobs), `hm-types` (the zod schemas of every type), `explore-query` (the query grammar), `schema-engine` and `schema-resolve` (Hypermedia Schemas), `keyfile`, `vault-local`, `cbor`, `dag-json`, `base64`. <!-- id:ipJVKiXp -->

```ts <!-- id:X9UdU4Q6 -->
import {createSeedClient, createDocumentBlobs, unpackHmId} from '@seed-hypermedia/client'
import {HMDocumentSchema} from '@seed-hypermedia/client/hm-types'
import * as blobs from '@seed-hypermedia/client/blobs'
```

# The client <!-- id:G8_2Vjlf -->

```ts <!-- id:bjx-H8v5 -->
createSeedClient(baseUrl: string, options?: {fetch?, headers?}): SeedClient

type SeedClient = {
  baseUrl: string
  request<K extends HMRequest['key']>(key: K, input, options?: {signal?: AbortSignal}): Promise<output>
  publish(input: {blobs: {cid?: string; data: Uint8Array}[]}): Promise<{cids: string[]}>
  publishBlobs: same as publish
  publishDocument(input: PublishDocumentInput, signer: AnySigner): Promise<{version, genesis, generation}>
}
```

`baseUrl` is the origin of any Seed web server: `https://hyper.media`, your own site, or the desktop app's local bridge (`http://localhost:56004` in the installed app, `58004` in a dev build). The client speaks the [Seed API](./web-api.md) at `/api/<Key>`. It never talks to the daemon's [gRPC](./grpc.md) port. <!-- id:PZyny0Lq -->

`request(key, input)` validates the input against the zod schema for that key, sends it, and validates the output. Read keys go out as `GET /api/<Key>?…`. The five action keys (`PublishBlobs`, `PrepareDocumentChange`, `QueryDocuments`, `ListDocumentAttributeNames`, `ListDocumentAttributeValues`) go out as `POST /api/<Key>` with a DAG-CBOR body. Responses arrive superjson-wrapped and are unwrapped for you, except the three document passthroughs (`QueryDocuments` and the two attribute listings), which return the daemon's plain protobuf JSON. <!-- id:XhGgqBm0 -->

`headers` can be an object or a function returning one, which is how you attach `Authorization: Bearer <token>` for [private](../protocol/privacy.md) reads. Errors are typed: `SeedValidationError` (bad input or unknown key), `SeedNetworkError` (fetch itself failed) and `SeedClientError` (a non-2xx status, with the server's `error` text folded into the message and the status and body kept on the error). <!-- id:6IVkEoy5 -->

# Identity and signing <!-- id:aOnfRV6A -->

Everything you publish is signed by an Ed25519 [key](./keys.md). The SDK does not care where that key lives. It needs a signer: <!-- id:zpT6PJkA -->

```ts <!-- id:FvwUSu0k -->
type HMSigner = {getPublicKey(): Promise<Uint8Array>; sign(data: Uint8Array): Promise<Uint8Array>}
type PrincipalSigner = {readonly principal: Uint8Array; sign(data: Uint8Array): Promise<Uint8Array>}
type AnySigner = HMSigner | PrincipalSigner   // every builder accepts either
```

`getPublicKey` returns the 34-byte [principal](../principal.md): the bytes `0xed 0x01` followed by the 32-byte public key. Encoded as base58btc it is the `z6Mk…` [account](../protocol/identity.md) id. `toHMSigner` and `toPrincipalSigner` convert between the two shapes. <!-- id:sdXbBoO8 -->

Ways to get a signer: <!-- id:qpp5jevD -->
  - **Generate a key** with `generateNobleKeyPair()` from the `blobs` module, or rebuild one from a 32-byte seed with `nobleKeyPairFromSeed(seed)`. A `NobleKeyPair` is a `PrincipalSigner`. <!-- id:qXOpzGb8 -->
  - **Load a `.hmkey.json` file** exported by the Seed app or `seed-cli key export`: `keyfile.load(json, password?)` returns `{payload, seed, publicKey}`. Pass the seed to `nobleKeyPairFromSeed`. See [Keys](./keys.md) for the file format. <!-- id:jCg6OIGr -->
  - **Read a local vault** of the desktop app or daemon with `loadLocalVaultAccounts({path?, dev?})` from `vault-local`. It is read-only and decrypts the vault with the secret from the OS keychain or the `SEED_VAULT_KEK` variable. <!-- id:xEo2w0p4 -->
  - **A browser session key** delegated by the user's vault: `createSessionSigner(session)` from the `auth` module. See [Sign in with Seed](./sign-in.md). <!-- id:e3FZkPxH -->

Mnemonic derivation (BIP-39 words to a key) is not in the SDK. The Seed CLI and the apps do it with SLIP-10 at path `m/44'/104109'/0'`. [Keys](./keys.md) has the details. <!-- id:M-A1HFWn -->

Principal helpers live in `blobs`: `principalFromEd25519(raw32)`, `principalToString(p)`, `principalFromString(s)`, `principalEqual(a, b)`. <!-- id:-dYqRzow -->

# Reading <!-- id:mMEuFgXG -->

Ids first. `unpackHmId('hm://<uid>/<path>?v=<version>#<block>')` returns an `UnpackedHypermediaId` with `uid`, `path` (an array or null), `version`, `blockRef`, `blockRange` and `latest`. `packHmId` reverses it. See [URLs](../protocol/urls.md) for the id grammar. `resolveHypermediaUrl(url)` turns a web URL into an id by asking the [site](../protocol/sites.md) with an `OPTIONS` request and reading its `X-Hypermedia-*` headers. `resolveId` accepts either form. `resolveIdWithClient(rawId, {client?, serverUrl?})` also returns a client for the URL's own origin, which is why a web URL argument to the CLI ignores `--server`. <!-- id:gTrS54tf -->

```ts <!-- id:QC9HsuXk -->
const client = createSeedClient('https://hyper.media')
const id = unpackHmId('hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/build/sdk')!
const resource = await client.request('Resource', id)
if (resource.type === 'document') console.log(resource.document.metadata.name)
```

The keys you will use most: <!-- id:SgBrNcQY -->

<!-- id:-23opo3a -->
| Key <!-- col:d7BKam6L --> | Input <!-- col:6ZeAVhqr --> | Gives you <!-- col:zCYxtb0w --> <!-- id:oTgoz8L8 --> |
| --- | --- | --- |
| `Resource` | an unpacked id | a document, comment, redirect, tombstone or `not-found` <!-- id:zIGyryB_ --> |
| `ResourceMetadata` | an unpacked id | metadata only, cheap <!-- id:_OLiFEiW --> |
| `Account` | a uid string | the account and its home document metadata <!-- id:Jr9071Rh --> |
| `Query` | `{includes: [{space, path?, mode}], sort?, limit?}` | a directory listing (`Children` or `AllDescendants`) <!-- id:YjdRd2zH --> |
| `QueryDocuments` | `{filter?, sort?, pageSize?, pageToken?}` | documents matched by attribute; see [Query grammar](./query-grammar.md) <!-- id:ksiY2jWj --> |
| `Search` | `{query, accountUid?, includeBody?, searchType?, …}` | ranked hits <!-- id:QbzoS6bQ --> |
| `ListComments`, `ListDiscussions` | `{targetId}` | comments on a document <!-- id:tFas-lWK --> |
| `ListChanges` | `{targetId}` | the change DAG (used to build updates) <!-- id:S0sAKPyD --> |
| `ListCitations` | `{targetId}` | who links here <!-- id:De29a4uP --> |
| `ListCapabilities` | `{targetId}` | who may write here <!-- id:FhpQy98b --> |
| `ListEvents` | paging and filters | the activity feed <!-- id:xkvNNLJj --> |
| `GetCID` | `{cid}` | `{value}`: a stored blob decoded to DAG-JSON <!-- id:r_m2eGVm --> |
| `DiscoveryStatus` | `{uid, path, version?, latest?}` | whether the site has found a resource yet <!-- id:Ls9FCHT_ --> |

`HMResource` is a union on `type`: `document`, `comment`, `redirect` (with `redirectTarget` and `republish`), `not-found`, `tombstone`, `error`. `HMDocument` carries `content` (a tree of `{block, children?}`), `metadata`, `version`, `genesis`, `authors`, `generationInfo` and [`visibility`](../protocol/privacy.md). Every key's exact input and output shape is a page under [the Seed API](../rpc.md). <!-- id:UBN1iThC -->

To follow [moves and republishes](../protocol/documents.md), `followRedirects(client, id)` walks the redirect chain, `followToDocument` stops at the first document, and `resolveEditableDocument` returns what an editor should load together with the address that a new change must take over. <!-- id:NY7ZIh68 -->

# Writing documents <!-- id:msXJ2N75 -->

A document is a DAG of signed Change blobs plus a [Ref](../ref.md) that names the current heads. [Documents](../protocol/documents.md) explains the model. The SDK gives you the operations, the builders and one rule you must not break. <!-- id:xhWXVeM_ -->

```ts <!-- id:o5ss_SHV -->
type DocumentOperation =
  | {type: 'SetAttributes'; attrs: {key: string[]; value: string | number | boolean | null}[]}
  | {type: 'ReplaceBlock'; block: unknown}
  | {type: 'MoveBlocks'; blocks: string[]; parent: string}
  | {type: 'DeleteBlocks'; blocks: string[]}
```

**Create a document.** `createDocumentBlobs(signer, {space, path, ops, capability?, generation?, visibility?})` returns `{blobs, genesis, version, ts}` ready for `client.publish`. `path` is `''` for the account's home document and `/a/b` otherwise. <!-- id:Ne_vAKqX -->

```ts <!-- id:2cLGvPZP -->
const {blobs} = await createDocumentBlobs(signer, {
  space: myUid,
  path: '/notes/first',
  ops: [
    {type: 'SetAttributes', attrs: [{key: ['name'], value: 'First note'}]},
    {type: 'ReplaceBlock', block: {id: 'b1', type: 'Paragraph', text: 'Hello.', annotations: []}},
    {type: 'MoveBlocks', blocks: ['b1'], parent: ''},
  ],
})
await client.publish({blobs})
```

**The genesis rule.** A document's identity is its genesis Change. For the home document (path `''`) the genesis is deterministic: the signer's key and a zero timestamp. Every device of an account, and the daemon itself, derive the same one. Every other document has no genesis blob of its own. Its first content Change is its genesis, with no `genesis` or `deps` fields, and the Ref points its `genesis` and its head at that same Change. Creating an ordinary document on the home genesis merges it with the home document as far as the daemon is concerned: comments, activity and moves all collapse into one. So `createDocumentBlobs` decides this for you, and `createGenesisChange` is deprecated in favour of the explicit `createHomeGenesisChange`. Only the owner can create a home. The builder refuses any other signer for path `''`. <!-- id:2HwrtkSZ -->

**Update a document.** Fetch the current state, build a Change on the heads, and publish it with a fresh Ref: <!-- id:7sbzYzez -->

```ts <!-- id:zrESMCQd -->
const state = await resolveDocumentState(client, 'hm://' + myUid + '/notes/first')
const {unsignedBytes, ts} = createChangeOps({
  ops,
  genesisCid: CID.parse(state.genesis),
  deps: state.heads.map((h) => CID.parse(h)),
  depth: state.headDepth + 1,
})
const change = await createChange(unsignedBytes, signer)
const ref = await createVersionRef(
  {space: myUid, path: '/notes/first', genesis: state.genesis, version: change.cid.toString(), generation: Number(ts)},
  signer,
)
await client.publish({blobs: [{data: change.bytes, cid: change.cid.toString()}, ...ref.blobs]})
```

`resolveDocumentState` walks `ListChanges` to find the genesis, the heads and the head depth (depth is not in the read API, so it is recomputed). `createChangeOps` builds the unsigned CBOR. `createChange` signs it and returns `{bytes, cid, genesis, ts}`. Concurrent heads merge by listing several `deps`. <!-- id:3p3tUyJA -->

**Let the server build the ops.** `client.publishDocument({account, path?, changes, baseVersion?, genesis?, generation?, capability?, visibility?}, signer)` takes proto-style changes (the shape the app's editor produces), asks the site's `PrepareDocumentChange` to compute the [CRDT](../protocol/documents.md) ops, signs the result with `signDocumentChange` and publishes. It also bootstraps a brand-new home document client-side. The Seed web app uses this path. Scripts that already have block-level ops can stay with the builders above. <!-- id:52j70u2p -->

**Refs.** `createVersionRef` points a path at a [version](../protocol/documents.md) (this is also a fork: a new path on an existing genesis). `createTombstoneRef({space, path, genesis, generation, capability?})` deletes. `createRedirectRef({space, path, genesis, generation, targetSpace?, targetPath, republish?})` moves a path elsewhere, and with `republish: true` shows the target's content in place. A Ref with a higher [`generation`](../protocol/documents.md) supersedes the one at the path, so a takeover mints `Date.now()`. <!-- id:jhjnuaot -->

**Writing into someone else's space.** Pass `capability: <cid>` on every Change-carrying Ref, tombstone and redirect. A [capability](../protocol/permissions.md) is what lets your key write there. `resolveCapability(client, targetAccount, signerAccount, path?)` finds a WRITER or AGENT capability the space published for your key and returns its CID, or `undefined` when you are the owner. See [Permissions](../protocol/permissions.md). <!-- id:83ddWDHQ -->

**The CID rule.** Every blob you publish that another blob references by CID must be published with its `cid` set. The SDK computes [CIDs](../protocol/blobs.md) with SHA-256. The daemon computes a BLAKE2b CID for any blob that arrives without one, and then the reference from the next blob points at nothing. The builders fill `cid` for you. Keep it when you assemble your own `publish` payload. <!-- id:0RkGAVtI -->

# Comments, contacts, profiles, capabilities <!-- id:ONoosCgT -->

These are snapshot blobs, replaced whole on edit and addressed as `<author>/<tsid>`. See [Comments](../protocol/comments.md), [contacts and capabilities](../protocol/permissions.md), and [Identity](../protocol/identity.md) for profiles. <!-- id:tIj1HebI -->

```ts <!-- id:I2aG-U6E -->
createComment({docId, docVersion, content: HMBlockNode[], replyCommentVersion?, rootReplyCommentVersion?, quoting?, visibility?}, signer)
updateComment({commentId, targetAccount, targetPath, targetVersion, content, replyParentVersion?, rootReplyCommentVersion?}, signer)
deleteComment({commentId, targetAccount, targetPath, targetVersion}, signer)
commentRecordIdFromBlob(bytes)                       // "<author>/<tsid>"

createContact({subjectUid, accountUid?, name?, subscribe?}, signer)   // → publish input + recordId
updateContact(...)  deleteContact(...)  contactRecordIdFromBlob(...)

createCapability({delegateUid, role: 'WRITER' | 'AGENT', path?, label?}, signer)
resolveCapability(client, targetAccount, signerAccount, path?)

blobs.createProfile(signer, {name, avatar?, description?}, ts)      // Encoded<Profile>
blobs.createProfileAlias(...)
```

A comment pins the target `docVersion` it was written against. `quoting: {blockId, range?}` makes a block comment: the content is wrapped in an [Embed](../protocol/blocks.md) of that block at that version. Replies carry the parent comment's version and the thread root's version. `docId` is an `UnpackedHypermediaId`. <!-- id:loumVdX9 -->

# Files and media <!-- id:x9aN7_BH -->

`fileToIpfsBlobs(bytes)` chunks a file into UnixFS blocks and returns the blocks plus the root CID, so an image becomes `ipfs://<cid>` in a block's `link` or in `metadata.icon`. `filesToIpfsBlobs` does several at once. `resolveFileLinksInBlocks` replaces `file://` links in a block tree with published `ipfs://` links, and `hasFileLinks` tells you whether there is anything to upload. Publish the file blocks in the same `publish` call as the document that links them, or the [gateway](../protocol/sites.md) will report them as not public. [Files](../protocol/files.md) has the rules. <!-- id:aAxXX4-N -->

# The markdown dialect <!-- id:ZwTWCrBr -->

`blocksToMarkdown(doc)` and `parseMarkdown(md)` are a lossless pair: every [block](../protocol/blocks.md) type, [annotation](../protocol/blocks.md), attribute and [metadata](../metadata.md) key survives a round trip. The frontmatter is YAML with every metadata key. Each block ends in an `<!-- id:X -->` comment, with `type:` and `attrs:` in the same comment for what markdown cannot express. Nesting is indentation. `parseMarkdown` returns `{tree, metadata}` and `flattenToOperations` turns the tree into `DocumentOperation`s. `markdownBlockNodesToHMBlockNodes` converts the parsed tree to the API shape. [Publish a folder](./publish-a-folder.md) describes the dialect as a writer sees it. <!-- id:WvgA5VpZ -->

For display, `documentToResolvedMarkdown(doc, {client, maxDepth?})`, `commentToResolvedMarkdown` and `contentToResolvedMarkdown` fetch embeds, [mentions](../protocol/comments.md) and [query blocks](../protocol/blocks.md) over the network and inline them. The web `.md` export and the agents' [`read`](../agent/read.md) verb return this form. <!-- id:60n-DBmo -->

Drafts: `slugify(title)`, `draftFilename(slug, id)` (`<slug>_<id>.md`) and `parseDraftFilename` name draft files the way the CLI and the desktop app do. <!-- id:wxZ_H1P7 -->

# Typed documents and your own blobs <!-- id:51hJgH0T -->

The Hypermedia Schemas library ships inside the package. `schema-engine` bundles every schema and its published CID (`HM_SCHEMAS`, `HM_SCHEMA_MANIFEST`) and validates values offline: `load(ref)`, `validate(value, schema, registry)`, `structFields`, `requiredFieldNames`, `resolveSchema`. `schema-resolve` does the parts that need a client: `resolveSchemaRef(client, ref)` for a CID, a library URL or a type document's URL, `effectiveSchemaRef` (a document's own `attributesSchema`, else its parent's `childAttributesSchema`) and `checkDocumentSchema`. [Hypermedia Schemas](../schema.md) explains the model, and [Typed documents](../schema/typed-documents.md) explains the binding keys. <!-- id:XIWtKT9L -->

`signed-blob` signs any value as a Hypermedia blob: `signBlob(signer, body, {typeTag?, ts?})` adds `signer`, `ts` and `sig`, encodes [canonical DAG-CBOR](../schema/encoding.md) and returns `{cid, data}`. `publishSignedBlob(client, signer, body, opts)` also publishes, and refuses a `type` tag that collides with a built-in Seed type. `verifySignedBlob(value)` checks a signature the way the daemon does. The signing rule is the same everywhere: encode the blob with `sig` set to 64 zero bytes, sign those bytes, fill `sig`, encode again, hash with SHA-256. [Blobs](../protocol/blobs.md) has the envelope. <!-- id:aubbprT3 -->

# Sign in with Seed <!-- id:FqfZWgTO -->

The `auth` module implements the browser half of third-party sign-in: `startAuth`, `handleCallback`, `getSession`, `createSessionSigner`, `clearSession`. It is browser-only (WebCrypto Ed25519, IndexedDB, `CompressionStream`). [Sign in with Seed](./sign-in.md) walks through it. <!-- id:iDKOsNLF -->

# Editor interop <!-- id:yFaFo2ti -->

If you are building an editor, `hm-types` has the zod schemas for every block, annotation and metadata key (`HMBlockSchema`, `HMDocumentSchema`, `HMRequestSchema`, …), and the barrel exports the converters the Seed editor uses: `hmBlocksToEditorContent`, `editorBlocksToHMBlockNodes`, `hmBlockToEditorBlock`, `editorBlockToHMBlock`. The `block-diff` module (`createBlocksMap`, `matchBlockIds`, `computeReplaceOps`, `rebindTableIdentities`) is how the CLI's `document update` and folder sync turn an edited tree into the minimal set of operations. <!-- id:a0m_gFJG -->

# Working with it <!-- id:QbNk3cwH -->

## In the Seed app <!-- id:FomhsnuD -->

The desktop and web apps use this same package. The app is the reference client for what the builders produce. <!-- id:fUX0pkdG -->

## CLI <!-- id:eoNpl-XY -->

Every write in the [Seed CLI](./cli.md) is one of the builders above followed by `client.publish`. Read the CLI's source when you want a worked example of a command. <!-- id:KYsIMo9N -->

## Web API <!-- id:OqhTTr_X -->

The client is a thin layer over the [Seed API](./web-api.md). Anything the SDK does, you can do with `curl` and a CBOR encoder. <!-- id:vRTql5ol -->

## Agents <!-- id:RZwid2d1 -->

Seed Agents call these same functions when an agent's [`write`](../agent/write.md) verb publishes to an `hm://` address, signing with server-held identities. Its `read` verb returns resolved markdown from this package. An external agent that scripts against Seed (a Claude Code session, a bot) should prefer the CLI for one-off commands and this package for anything long-running. See [Using Seed from your own agent](./agents.md). <!-- id:H20iogTF -->

# See also <!-- id:WLNqrO8T -->

- [Getting started](./getting-started.md) <!-- id:oW9Seojf -->
- [Seed API](./web-api.md) <!-- id:7ckPCJ6j -->
- [Blobs](../protocol/blobs.md) <!-- id:HKj6dP4l -->
- [Change](../change.md), the blob a document is built from <!-- id:cysKeVxe -->
- [Seed CLI](./cli.md)
- [Keys](./keys.md)
- [Sign in with Seed](./sign-in.md)
- [Query grammar](./query-grammar.md)
