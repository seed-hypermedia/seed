---
name: Publishing from code
summary: A walkthrough of creating a document, updating it and commenting on it from TypeScript with the SDK, from loading a key to publishing the signed blobs.
---
This guide publishes a [document](../protocol/documents.md) from a TypeScript program, then updates it. It uses the [SDK](./sdk.md), `@seed-hypermedia/client`, which builds and signs the [blobs](../protocol/blobs.md) on your machine and sends them to any Seed [site](../protocol/sites.md). Read [Getting started](./getting-started.md) first if you have not published with the [CLI](./cli.md) yet. The SDK page is the reference for every function used here.

**Goal.** A script that loads a key, creates a document at a path in your [space](../protocol/spaces.md), and later publishes an edit on top of it.

**Prerequisites.** Node.js 18 or newer, and a key exported as a `.hmkey.json` file with `seed-cli key export`. [Keys](./keys.md) describes the file.

# 1. Install and load a key

```sh
npm install @seed-hypermedia/client zod@^3
```

Everything you publish is signed by a key, and the SDK needs a signer. Load the key file and rebuild the key pair from its seed.

```ts
import {readFile} from 'node:fs/promises'
import {createSeedClient, createDocumentBlobs, keyfile} from '@seed-hypermedia/client'
import * as blobs from '@seed-hypermedia/client/blobs'

const client = createSeedClient('https://hyper.media')
const {seed, publicKey: myUid} = await keyfile.load(await readFile('bot.hmkey.json', 'utf8'))   // myUid is the z6Mk… account id
const signer = blobs.nobleKeyPairFromSeed(seed)
```

# 2. Create a document

A document is built from operations: set attributes, put a block, place blocks under a parent. `createDocumentBlobs` turns them into the signed [Change](../change.md) and [Ref](../ref.md) blobs, ready to publish.

```ts
const {blobs: created} = await createDocumentBlobs(signer, {
  space: myUid,
  path: '/notes/first',
  ops: [
    {type: 'SetAttributes', attrs: [{key: ['name'], value: 'First note'}]},
    {type: 'ReplaceBlock', block: {id: 'b1', type: 'Paragraph', text: 'Hello.', annotations: []}},
    {type: 'MoveBlocks', blocks: ['b1'], parent: ''},
  ],
})
await client.publish({blobs: created})
```

`path` is `''` for the account's home document and `/a/b` otherwise. The builder decides how the document's first change is made, which differs between a home document and any other. Do not build that first change by hand: [Documents](../protocol/documents.md) explains the genesis, and the SDK page states the rule.

# 3. Update it

To edit, fetch the current state, build a change on its heads, and publish it with a fresh Ref.

```ts
import {CID} from 'multiformats/cid'
import {resolveDocumentState, createChangeOps, createChange, createVersionRef} from '@seed-hypermedia/client'

const state = await resolveDocumentState(client, 'hm://' + myUid + '/notes/first')
const {unsignedBytes, ts} = createChangeOps({
  ops: [{type: 'ReplaceBlock', block: {id: 'b1', type: 'Paragraph', text: 'Hello again.', annotations: []}}],
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

Reusing the block id `b1` makes this an edit of the same [block](../protocol/blocks.md), so comments anchored to it keep their anchor. Keep the `cid` on every blob you assemble yourself. A blob that another blob references must be published with the CID the SDK computed.

# 4. Write into someone else's space

Your key can write in a space it does not own when that space published a [capability](../protocol/permissions.md) for it. `resolveCapability(client, targetAccount, signerAccount, path?)` finds it and returns its CID, or `undefined` when you are the owner. Pass that as `capability` to `createDocumentBlobs` and `createVersionRef`. [A key for a bot](./keys.md) shows how the owner issues one.

# 5. Comment

A [comment](../protocol/comments.md) is one more builder: `createComment({docId, docVersion, content}, signer)` returns a publish input, and `client.publish` sends it.

# See also

- [SDK](./sdk.md), the reference for the builders, the signer contract, Refs, files and errors.
- [Seed API](./web-api.md), for the `PublishBlobs` request underneath `client.publish`.
- [Markdown dialect](./markdown-dialect.md), to produce operations from a markdown file instead of by hand.
- [Publish a folder](./publish-a-folder.md), when the source is a directory of files.
- [Documents](../protocol/documents.md) and [Blobs](../protocol/blobs.md), for the model behind the calls.
