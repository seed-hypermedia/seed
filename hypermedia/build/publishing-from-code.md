---
name: Publishing from code
summary: This guide walks through creating a document, updating it and commenting on it from a TypeScript program with the SDK, from loading a key to publishing the signed blobs.
---
This guide shows a TypeScript program that publishes a [document](../protocol/documents.md) and then updates it. The program uses the [SDK](./sdk.md), the package `@seed-hypermedia/client`. The SDK builds and signs the [blobs](../protocol/blobs.md) on your machine and sends them to any Seed [site](../protocol/sites.md). A blob is one signed piece of data, and a document is made of them.

If you have not published with the [CLI](./cli.md) before, read [Getting started](./getting-started.md) first. The SDK page is the reference for every function used here.

**Goal.** A script that loads a key, creates a document at a path in your [space](../protocol/spaces.md), and later publishes an edit on top of it.

**What you need.** Node.js 18 or newer, and a key saved as a `.hmkey.json` file. You make that file with `seed-cli key export`. [Keys](./keys.md) describes it.

# 1. Install and load a key

Install the SDK. It needs `zod` beside it, and the update step imports `multiformats`.

```sh
npm install @seed-hypermedia/client zod@^4.6.6 multiformats
```

Everything you publish is signed by a key. So the SDK needs a signer, an object that can sign with your key. Load the key file and rebuild the key pair from the seed inside it.

```ts
import {readFile} from 'node:fs/promises'
import {createSeedClient, createDocumentBlobs, keyfile} from '@seed-hypermedia/client'
import * as blobs from '@seed-hypermedia/client/blobs'

const client = createSeedClient('https://hyper.media')
const {seed, publicKey: myUid} = await keyfile.load(await readFile('bot.hmkey.json', 'utf8'))   // myUid is the z6Mk… account id
const signer = blobs.nobleKeyPairFromSeed(seed)
```

`myUid` is your [account](../protocol/identity.md) id. It is also the name of your space.

# 2. Create a document

You build a document from operations. An operation is one small step: set attributes, put a block, or place blocks under a parent. `createDocumentBlobs` turns the operations into two signed blobs, a [Change](../change.md) and a [Ref](../ref.md). The Change holds the steps. The Ref says which version of the document is at the path.

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

`path` is `''` for the account's [home document](../protocol/spaces.md) and `/a/b` for any other document.

Let the builder make the document's first change. That first change is made in one way for a home document and in another way for every other document, and the builder knows which. Do not build it by hand. [Documents](../protocol/documents.md) explains the first change, called the genesis, and the SDK page states the rule.

# 3. Update it

An edit takes three steps:

1. Fetch the document's current state.
2. Build a change on top of its heads. The heads are the latest changes of the document.
3. Publish the change with a new Ref.

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

Two rules to keep:

- **Reuse block ids.** The edit uses the id `b1` again, so it changes the same [block](../protocol/blocks.md). Comments attached to that block stay attached.
- **Keep the `cid` on every blob you put together yourself.** A [CID](../cid.md) is the id of a blob, computed from its bytes. When another blob points at a blob, you must publish it with the CID the SDK computed.

# 4. Write into someone else's space

Your key can write in a space it does not own when that space has published a [capability](../protocol/permissions.md) for it. A capability is a signed permission from one key to another.

1. Find the capability with `resolveCapability(client, targetAccount, signerAccount, path?)`. It returns the capability's CID.
2. Check the result. It is `undefined` when you are the owner, and also when no capability was found. If you are not the owner and you get `undefined`, stop: the site refuses what you publish without a capability.
3. Pass the CID as `capability` to `createDocumentBlobs` and `createVersionRef`.

[A key for a bot](./keys.md) shows how the owner gives a capability.

# 5. Comment

A [comment](../protocol/comments.md) has a builder too. `createComment({docId, docVersion, content}, signer)` returns what `client.publish` takes, so you pass the result straight to `client.publish`.

# See also

- [SDK](./sdk.md), the reference for the builders, the signer, Refs, files and errors.
- [Seed API](./web-api.md), for the `PublishBlobs` request that `client.publish` sends.
- [Markdown dialect](./markdown-dialect.md), to make operations from a markdown file and not by hand.
- [Publish a folder](./publish-a-folder.md), when the source is a folder of files.
- [Documents](../protocol/documents.md) and [Blobs](../protocol/blobs.md), for the model behind the calls.
