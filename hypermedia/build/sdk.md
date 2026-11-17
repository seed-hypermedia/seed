---
name: SDK
summary: The SDK is the TypeScript package @seed-hypermedia/client, and this page shows how to install it, read documents, and build, sign and publish your own.
---
The SDK is the TypeScript package `@seed-hypermedia/client`. It reads [documents](../protocol/documents.md), builds and signs new ones, and publishes them. The [Seed app](../software/desktop.md), the [Seed web app](../software/web.md), the [Seed CLI](./cli.md), the [vault](../software/vault.md) and [Seed Agents](../agent.md) all use this same package, so what works here works in all of them.

The package knows how to encode and sign a [blob](../protocol/blobs.md), how to build a document [change](../change.md), how to turn a document into [markdown](./markdown-dialect.md) and back, and how to look up a [schema](../schema.md). It does not need React or a [daemon](../software/daemon.md). It only needs `fetch`, so it runs in Node, Bun, browsers and React Native. <!-- id:GKERgZSz -->

This page is the reference. If you have never published anything, start with [Getting started](./getting-started.md). If you only need to read public data, the [Seed API](./web-api.md) over plain HTTP may be enough. <!-- id:uMFhMR5F -->

# Install and import <!-- id:abDQXJxO -->

```sh <!-- id:4E34K789 -->
npm install @seed-hypermedia/client zod@^4.6.6
```

<!-- id:Y-oJftG2 -->
| Fact <!-- col:FQJZD8im --> | Value <!-- col:rd5Y0WyZ --> <!-- id:v6ok3yak --> |
| --- | --- |
| Package | `@seed-hypermedia/client` on npm, ESM only <!-- id:1mgZ2PJd --> |
| Peer dependencies | `zod` `^4.6.6` (required), `pdfjs-dist` (optional, only for `pdfToBlocks`) <!-- id:90a1wpUr --> |
| Entry points | the root barrel, plus every module as a subpath: `@seed-hypermedia/client/<module>` <!-- id:0gOFrB-S --> |
| Runtime requirements | `fetch`; WebCrypto only for the browser sign-in module <!-- id:pjILNryS --> |
| Versioning | CI publishes a new patch on every push to `main` that touches the package, so the npm version is always ahead of the repository's `package.json`. Pin the version you tested against <!-- id:ubGO5w0Y --> |

The root barrel exports the client, the blob builders, the markdown dialect, the id helpers and the document-state helpers. Some modules are not in the root barrel. You import them by their subpath: `auth` (browser sign-in), `hmauth` (the sign-in protocol), `blobs` (key pairs, [profiles](../profile.md), low-level capability and signing primitives), `signed-blob` (user-defined signed blobs), `hm-types` (the zod schemas of every type), `explore-query` (the query grammar), `schema-engine` and `schema-resolve` (Hypermedia Schemas), `vault-local`, `cbor`, `dag-json`, `base64`. `keyfile` has a subpath and is also exported from the root as `keyfile`. <!-- id:ipJVKiXp -->

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
  putBlob(blob: {cid: string; data: Uint8Array}, options?: {signal?: AbortSignal}): Promise<void>   // one blob through POST /ipfs/<cid>
  daemonBlobCid(data: Uint8Array): string   // the CID the daemon gives a DAG-CBOR blob published without one
  publishDocument(input: PublishDocumentInput, signer: AnySigner): Promise<{version, genesis, generation}>
}
```

`baseUrl` is the address of any Seed web server: `https://hyper.media`, your own site, or the desktop app's local bridge (`http://localhost:56004` in the installed app, `58004` in a dev build). The client speaks the [Seed API](./web-api.md) at `/api/<Key>`. It never talks to the daemon's [gRPC](./grpc.md) port. <!-- id:PZyny0Lq -->

`request(key, input)` validates the input against the zod schema for that key, sends it, and validates the output. Read keys go out as `GET /api/<Key>?…`. The five action keys (`PublishBlobs`, `PrepareDocumentChange`, `QueryDocuments`, `ListDocumentAttributeNames`, `ListDocumentAttributeValues`) go out as `POST /api/<Key>` with a [DAG-CBOR](../schema/dag-cbor.md) body. The client unwraps every response for you. Three keys (`QueryDocuments` and the two attribute listings) return the daemon's own JSON, so their field names follow the proto files.

Some sites limit the size of an API body. When a site refuses a `publish` body as too large (`413`), the client sends the blobs one by one with `putBlob`. <!-- id:XhGgqBm0 -->

`headers` can be an object or a function returning one, which is how you attach `Authorization: Bearer <token>` for [private](../protocol/privacy.md) reads. Errors are typed: `SeedValidationError` (bad input or unknown key), `SeedNetworkError` (fetch itself failed) and `SeedClientError` (a non-2xx status, with the server's `error` text folded into the message and the status and body kept on the error). <!-- id:6IVkEoy5 -->

# Identity and signing <!-- id:aOnfRV6A -->

Everything you publish is signed by an Ed25519 [key](../protocol/identity.md). The SDK does not care where that key lives. It needs a signer: <!-- id:zpT6PJkA -->

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
const id = unpackHmId('hm://z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/resources/self-host-seed')!
const resource = await client.request('Resource', id)
if (resource.type === 'document') console.log(resource.document.metadata.name)
```

The id must name an account by its `z6Mk…` id. The Seed API does not resolve a domain name inside an `hm://` URL. Every key, with its input and output, is in the [Seed API key tables](./web-api.md#the-keys). Inputs that the tables show as an `hm://` string are an unpacked id here.

`HMResource` is a union on `type`: `document`, `comment`, `redirect` (with `redirectTarget` and `republish`), `not-found`, `tombstone`, `error`. `HMDocument` carries `content` (a tree of `{block, children?}`), `metadata`, `version`, `genesis`, `authors`, `generationInfo` and [`visibility`](../protocol/privacy.md). <!-- id:UBN1iThC -->

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

**Create a document.** `createDocumentBlobs(signer, {space, path, ops, capability?, generation?, visibility?})` returns `{blobs, genesis, version, ts}` ready for `client.publish`. `space` is the account id of the [space](../protocol/spaces.md) you write into. `path` is `''` for the account's [home document](../protocol/spaces.md) and `/a/b` otherwise. <!-- id:Ne_vAKqX -->

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

**The genesis rule.** A document's identity is its genesis Change, and only a home document (path `''`) has a deterministic one. [Documents](../protocol/documents.md) has the rule. `createDocumentBlobs` applies it for you: an ordinary document's first content Change is its genesis, and a home document starts from `createHomeGenesisChange`. `createGenesisChange` is the older name of that function. Only the owner can create a home. The builder refuses any other signer for path `''`. <!-- id:2HwrtkSZ -->

**Update a document.** Read the document and its heads, hand your ops to `documentUpdateBlobs`, and publish what it returns: <!-- id:7sbzYzez -->

```ts <!-- id:zrESMCQd -->
const base = await resolveEditableDocument(client, unpackHmId('hm://' + myUid + '/notes/first')!)
const update = await documentUpdateBlobs({
  client,
  signer,
  account: base.targetId.uid,
  path: '/notes/first',
  state: base.state,
  ops,
  content: base.document.content ?? [],
  documentVersion: base.document.version,
  currentGeneration: base.document.generationInfo?.generation,
})
if (update.changed) await client.publish({blobs: update.blobs})
```

`documentUpdateBlobs({client, signer, account, path?, state, ops, content, documentVersion?, localOps?, capability?, currentGeneration?, visibility?, now?, prepareTimeoutMs?, maxPreparedChangeBytes?})` is the one way to update a document. It asks the site's daemon for the Change, so that only what differs is stored, and returns `{changed: true, blobs, version, genesis, generation, ts, depth, builtBy, localReason?}`, or `{changed: false, blobs: [], version}` when the document already reads that way. It does not publish. `createDocumentUpdateBlobs`, the parent auto-link, the CLI's `document update` and `space import`, and the agents' write tool all go through it.

`builtBy` is `'server'` when the daemon computed the Change, and `'local'` when the helper built it itself with the ops as written; `localReason` then says why, in words that fit after "built locally because". The helper builds the Change itself when:

- `content` is not the content at the heads. The document and its heads come from two reads (`resolveEditableDocument` reads both again, once, when they differ). When `documentVersion` still does not name the heads of `state`, moves computed against that content are not sent.
- The ops cannot be put in a request the daemon applies correctly (see `preparableDocumentChanges` below), or hold an attribute value the request cannot carry.
- The daemon does not answer within `prepareTimeoutMs` (15 seconds). The request is aborted and the document is not asked about again by this process for ten minutes. A daemon without Seed PR #1375 never answers a request that moves or deletes blocks in a document whose history holds a block that was once put inside one of its own descendants, and keeps a CPU busy until it is restarted; the helper does not read the history to avoid that, so against such a daemon this timeout is what ends the wait.
- The site refuses the request as too large (413; some sites cap their API bodies at a few KB) or does not have `PrepareDocumentChange` at all.
- The daemon fails to apply the changes (a 500 such as "desired parent block is not in the tree" or "cycle detected"), or its clock is not past the document's latest Change ("must be greater than ts of its dependency").
- The Change the daemon answers with is not plausible for the request: it moves, replaces or deletes a block the request did not name, places a block more often than the request did, or is larger than `maxPreparedChangeBytes` (1 MB). Unfixed daemons repeat each move of a nested document once per earlier position of each ancestor, and have answered a one-block insert with megabytes.

Falling back is safe because `PrepareDocumentChange` only reads: the daemon loads the document, applies the changes in memory and returns unsigned bytes. Nothing is stored, so a request that failed, or is still running, cannot publish the update a second time. Errors that are yours to see are thrown as they are: a refusal for lack of permission, a 4xx about the request, and a network failure.

A Change built by the helper is stamped with this machine's clock, or one millisecond after the latest head (`state.headTs`, which `resolveDocumentState` reads from `ListChanges`) when the clock is not past it. A Change must be later than the Changes it builds on: the daemon stores one that is not, then reads the document as broken ("missing dependency"). The heads often carry another clock (a prepared Change carries the site's), so a machine a second behind is enough. The daemon also refuses to read a Change stamped 40 seconds or more ahead of its own clock, which no client can repair: keep clocks synchronised. `MoveBlocks` ops are stored parents first, so a parent and child that swap places do swap.

`localOps` is for a caller that keeps part of an update out of `ops` because the daemon cannot carry it: give the whole update there and it is what a locally built Change stores.

The parts are exported for callers that need one alone. `prepareDocumentUpdateBlobs({client, signer, account, path?, baseVersion, ops + content | changes, capability?, genesis?, generation?, currentGeneration?, visibility?})` sends the ops to the site's `PrepareDocumentChange`, where the [daemon](../apps/daemon.md) applies them to the document's real state and writes a Change holding only what differs. A block already in place is not moved, a block that already has that content is not replaced, an attribute that already has that value is not set. It then signs that Change and its Version Ref with your signer and returns `{changed: true, blobs, version, genesis, generation, ts, depth}`. It does not publish, so you can send the blobs together with file blobs or another document's blobs in one `client.publish`. The key never leaves your process. It has none of the guards above: no timeout, no check of the answer, and it throws where `documentUpdateBlobs` falls back. <!-- id:3p3tUyJA -->

When every op is already true of the document, the daemon answers with a Change that has no operations. The helper then returns `{changed: false, blobs: []}` and signs nothing. Do not publish in that case: there is no new version.

`ops` are converted with `preparableDocumentChanges(ops, content)`, which you can also call yourself. `content` is the content of the document the ops were computed against (`document.content` at `baseVersion`), and it is required when the ops move blocks. Every `replaceBlock` is sent before the first move or delete: the daemon learns that a new block can be a parent from its `replaceBlock`, but only until the first move, so a new section's content sent after a move made the move under it fail. Deletes and attributes follow in the order written. Each level a `MoveBlocks` orders is sent as the fewest moves that produce it: the blocks already in the right order are not mentioned, and every other block is placed after the block before it. A `MoveBlocks` has no anchor, so a list that is not the whole level places its blocks at the start of the parent, ahead of the others. To write a move yourself, pass `changes` with a `moveBlock` that names the `leftSibling`. `SetAttributes` values must be strings, whole numbers, booleans or null, and block attributes must be plain JSON. Anything else throws before the request is made.

The conversion exists because a real daemon misplaces blocks when it is sent a level as a diff lists it, first block first:

- **A first block "moved" to where it already is.** The daemon treats it as a move, discards it when it writes the Change, and then anchors the next block on nothing, so a block inserted right after an unchanged first block lands before it.
- **A block that still follows the same block.** Its move is not written, even when the block before it moved: `[a, b, c, d]` to `[a, c, d, b]` sent as a chain stores only the move of `c` and reads back `[a, c, b, d]`.

Sending the fewest moves avoids both, except for one shape: neighbouring blocks that move together (`[a, b, c, d]` to `[c, d, a, b]`), where a block that must move keeps the block before it. `preparableDocumentChanges` returns `{unpreparable: reason}` for that instead of `{changes}`, and `prepareDocumentUpdateBlobs` throws `UnpreparableDocumentUpdateError`. Build that update with `clientBuiltDocumentUpdateBlobs({signer, account, path?, state, ops, capability?, currentGeneration?})`, which stores the ops as listed on top of `state` (from `resolveEditableDocument` or `resolveDocumentState`) and returns the same `{changed: true, blobs, version, genesis, generation}`. `documentUpdateBlobs` does all of this for you. Three more shapes are `unpreparable`: a block that is both deleted and placed (the daemon keeps the delete and drops the placement), a level ordered twice, and a block put under one of its own descendants (a parent and child swapping places), which the daemon either refuses or never answers. `documentOperationsToChanges` is the plain conversion underneath; do not send its moves for a document that already has blocks.

One more thing a prepared update must not be sent:

- **A map cleared and set again.** A Change you build yourself can say "this key is exactly this map" as `{key: [k], value: null}` followed by every entry. Sent to the daemon, the unchanged entries are left out and the clear is kept, which removes the whole map. Send the entries, plus a `null` for each entry the document has and the new map does not. A key that changes between a plain value and a map needs no `null`: a write at a key removes what was stored above and below it.

A site may also refuse a large request body with a 413 (some cap their API bodies at a few KB). `client.publish` gets around that by storing blob by blob; a prepare request has no such route, so the Change is built here (`clientBuiltDocumentUpdateBlobs`) when that happens.

The Ref's generation is the new Change's timestamp unless you pass `generation`. Pass `currentGeneration` so the Ref never falls below the generation the path already has, which would leave the update published and ignored.

**Build the Change yourself.** `createChangeOps({ops, genesisCid, deps, depth})`, `createChange(unsignedBytes, signer)` and `createVersionRef` are still there, and `resolveDocumentState` walks `ListChanges` to find the genesis, the heads and the head depth for them. A Change built this way is stored exactly as written: an op that changes nothing is kept in the document's history, and a `MoveBlocks` that lists a whole level moves every block of it again. Use these for a document's first Change (which `createDocumentBlobs` does for you) or when no Seed API is in reach. For an update, use `documentUpdateBlobs`.

**Proto-style changes.** `client.publishDocument({account, path?, changes, baseVersion?, genesis?, generation?, capability?, visibility?}, signer)` takes proto-style changes (the shape the app's editor produces), asks the site's `PrepareDocumentChange` to compute the [CRDT](../protocol/documents.md) ops, signs the result with `signDocumentChange` and publishes. It also bootstraps a brand-new home document client-side. The Seed web app uses this path. <!-- id:52j70u2p -->

**Refs.** `createVersionRef` points a path at a [version](../protocol/documents.md) (this is also a fork: a new path on an existing genesis). `createTombstoneRef({space, path, genesis, generation, capability?})` deletes. `createRedirectRef({space, path, genesis, generation, targetSpace?, targetPath, republish?})` moves a path elsewhere, and with `republish: true` shows the target's content in place. A Ref with a higher [`generation`](../protocol/documents.md) supersedes the one at the path, so a takeover mints `Date.now()`. <!-- id:jhjnuaot -->

**Writing into someone else's space.** Pass `capability: <cid>` on every Change-carrying Ref, tombstone and redirect. A [capability](../protocol/permissions.md) is what lets your key write there. `resolveCapability(client, targetAccount, signerAccount, path?)` finds a WRITER or AGENT capability the space published for your key. It returns the capability's [CID](../cid.md). It returns `undefined` when you are the owner, and also when no capability was found, so check for that before you publish into someone else's space. See [Permissions](../protocol/permissions.md). <!-- id:83ddWDHQ -->

**The CID rule.** A blob that another blob references by CID must be published with its `cid` set. [Blobs](../protocol/blobs.md) has the rule and the two hashes behind it. The builders fill `cid` for you. Keep it when you assemble your own `publish` payload. <!-- id:0RkGAVtI -->

# Comments, contacts, profiles, capabilities <!-- id:ONoosCgT -->

These are snapshot blobs, replaced whole on edit and addressed as `<author>/<tsid>`. See [Comments](../protocol/comments.md), [contacts and capabilities](../protocol/contacts.md), and [Identity](../protocol/identity.md) for profiles. <!-- id:tIj1HebI -->

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

# Markdown

`blocksToMarkdown(doc)` and `parseMarkdown(md)` convert between a document and its lossless markdown form, and `documentToResolvedMarkdown` produces markdown for display. The format and every function around it are on the [markdown dialect](./markdown-dialect.md) page.

# Typed documents and your own blobs <!-- id:51hJgH0T -->

The Hypermedia Schemas library ships inside the package. `schema-engine` bundles every schema and its published CID (`HM_SCHEMAS`, `HM_SCHEMA_MANIFEST`) and validates values offline: `load(ref)`, `validate(value, schema, registry)`, `structFields`, `requiredFieldNames`, `resolveSchema`. `schema-resolve` does the parts that need a client: `resolveSchemaRef(client, ref)` for a CID, a library URL or a type document's URL, `effectiveSchemaRef` (a document's own `attributesSchema`, else its parent's `childAttributesSchema`) and `checkDocumentSchema`. [Hypermedia Schemas](../schema.md) explains the model, and [Typed documents](../schema/typed-documents.md) explains the binding keys. <!-- id:XIWtKT9L -->

`signed-blob` signs any value as a Hypermedia blob: `signBlob(signer, body, {typeTag?, ts?})` adds `signer`, `ts` and `sig`, encodes [canonical DAG-CBOR](../schema/encoding.md) and returns `{cid, data, ts, signer}`. `signBlob` wants an `HMSigner`, so wrap a key pair with `toHMSigner(keyPair)` first. `publishSignedBlob(client, signer, body, opts)` also publishes, and refuses a `type` tag that collides with a built-in Seed type. `verifySignedBlob(value)` checks a signature the way the daemon does. The signing rule is the same everywhere: encode the blob with `sig` set to 64 zero bytes, sign those bytes, fill `sig`, encode again, hash with SHA-256. [Blobs](../protocol/blobs.md) has the envelope. <!-- id:aubbprT3 -->

# Sign in with Seed <!-- id:FqfZWgTO -->

The `auth` module implements the browser half of third-party sign-in: `startAuth`, `handleCallback`, `getSession`, `createSessionSigner`, `clearSession`. It is browser-only (WebCrypto Ed25519, IndexedDB, `CompressionStream`). [Sign in with Seed](./sign-in.md) walks through it. <!-- id:iDKOsNLF -->

# Editor interop <!-- id:yFaFo2ti -->

If you are building an editor, `hm-types` has the zod schemas for every block, annotation and metadata key (`HMBlockSchema`, `HMDocumentSchema`, `HMRequestSchema`, …), and the barrel exports the converters the Seed editor uses: `hmBlocksToEditorContent`, `editorBlocksToHMBlockNodes`, `hmBlockToEditorBlock`, `editorBlockToHMBlock`. The `block-diff` module (`createBlocksMap`, `matchBlockIds`, `computeReplaceOps`, `rebindTableIdentities`) is how the CLI's `document update` and [folder sync](./publish-a-folder.md) turn an edited tree into the minimal set of operations. <!-- id:a0m_gFJG -->

# Working with it <!-- id:QbNk3cwH -->

## In the Seed app <!-- id:FomhsnuD -->

The desktop and web apps use this same package. The app is the reference client for what the builders produce. <!-- id:fUX0pkdG -->

## CLI <!-- id:eoNpl-XY -->

Every write in the [Seed CLI](./cli.md) is one of the builders above followed by `client.publish`. Read the CLI's source when you want a worked example of a command. <!-- id:KYsIMo9N -->

## Seed API <!-- id:OqhTTr_X -->

The client is a thin layer over the [Seed API](./web-api.md). Anything the SDK does, you can do with `curl` and a CBOR encoder. <!-- id:vRTql5ol -->

## Agents <!-- id:RZwid2d1 -->

Seed Agents call these same functions when an agent's [`write`](../agent/write.md) verb publishes to an `hm://` address, signing with server-held identities. Its `read` verb returns resolved markdown from this package. An external agent that scripts against Seed (a Claude Code session, a bot) should prefer the CLI for one-off commands and this package for anything long-running. See [Using Seed from your own agent](./agents.md). <!-- id:H20iogTF -->

# See also <!-- id:WLNqrO8T -->

- [Getting started](./getting-started.md) <!-- id:oW9Seojf -->
- [Seed API](./web-api.md) <!-- id:7ckPCJ6j -->
- [Blobs](../protocol/blobs.md) <!-- id:HKj6dP4l -->
- [Change](../change.md), the blob a document is built from <!-- id:cysKeVxe -->
- [Seed CLI](./cli.md) <!-- id:wcLvU_Qx -->
- [Keys](./keys.md) <!-- id:NjPCSXMt -->
- [Sign in with Seed](./sign-in.md) <!-- id:UDcI1Ddr -->
- [Markdown dialect](./markdown-dialect.md)
- [Query grammar](./query-grammar.md) <!-- id:cJXiZige -->
