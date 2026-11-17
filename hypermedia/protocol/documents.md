---
name: Documents
summary: A Hypermedia document is a graph of signed Change blobs whose current state is asserted by a Ref, and this page explains how changes merge, versions, generations, deletion, redirects and drafts.
---
A document in Hypermedia is a history: a chain of small signed edits, each pointing at the edits it builds on. Any reader can replay the chain and arrive at the same page. A separate signed note, the Ref, says which point in that history an address shows now. This design lets several people edit without a central server, lets anyone keep a fork, and lets a [link](./urls.md) name an exact version forever. <!-- id:Zm4VgoXG -->

Read [Signed Blobs](./blobs.md) first if the words blob, CID and signature are new. This page covers the change-based kind of [resource](../glossary.md), the document. [Comments](./comments.md), [contacts](./contacts.md) and [profiles](./identity.md) are snapshot blobs and have their own pages. <!-- id:rZNBZEnZ -->

# The mental model <!-- id:26xzaCgR -->

``` <!-- id:aWTPfzIh -->
build operations → create Change → sign Change → create Ref → sign Ref → publish blobs → daemon indexes → peers sync
```

A **[Change](../change.md)** is a [blob](./blobs.md) that describes the creation or edit of a document. Each change has three parts: <!-- id:6paxNCn4 -->
  - **operations**: a list of additions, modifications or removals of document state. <!-- id:Do15h1uK -->
  - **dependencies**: the other changes that must be applied before this one. <!-- id:zha2u5Ga -->
  - **authorship**: the signer, the signature and the timestamp. <!-- id:XFwa2lFM -->

Because a change links to its dependencies, the changes form a graph with no cycles, and a change usually represents a version of the document. The graph grows as the document evolves. A change may have several dependencies, so you can merge a branch back into the main line. <!-- id:fXamt7O- -->

A change can exist without affecting what readers see. The **[Ref](../ref.md)** blob states the current version of a document at an address. It holds a location (space and path), authorship, and the active version (the change CIDs that are the current heads). To read a document, find the newest Ref for the address, check that its signer is [allowed to write](./permissions.md) there, and replay the changes it points at. A Ref makes a document appear at an [`hm://` address](./urls.md). Without an indexed Ref the changes exist as raw blobs, and no document is listed. <!-- id:zeAp63Rn -->

# Changes <!-- id:drFf7M_Q -->

A [Change](../change.md) adds four fields to the [signed envelope](./blobs.md): `genesis`, `deps`, `depth` and `body`. The [change](../change.md) type page is the reference for the fields, the invariants the daemon enforces, the five operations and op ids. <!-- id:XIDPWVEy -->

**The genesis is the identity of the document.** Two Refs that name the same genesis are talking about the same document, wherever they place it. For an ordinary document the first content Change is the genesis. There is no separate empty genesis blob. The one exception is the home document of a space. Its genesis is an empty Change with `ts: 0` signed by the [account](./identity.md) key. It is deterministic on purpose, so every device of an account derives the same home genesis. Do not reuse it for any other document, or that document merges with the home document. <!-- id:-ZIgVBiD -->

The body is a list of operations. `SetAttributes` sets [metadata](../metadata.md) by key path. `ReplaceBlock` sets the whole state of one [block](./blocks.md). `MoveBlocks` places blocks under a parent. `DeleteBlocks` moves blocks to the trash. Every operation gets an op id `(ts, idx, actor)`: the change's timestamp, a counter inside the change, and a number derived from the signer. Op ids decide which of two concurrent edits wins.

## How concurrent edits resolve <!-- id:FkP5hdxs -->

The daemon replays a document's changes in dependency order and resolves conflicts with two small [CRDTs](https://crdt.tech/). A CRDT is a set of rules that brings every replica to the same state, in whatever order the changes arrived. <!-- id:On67PVZa -->

**Metadata is last-writer-wins by op id, with structural pruning.** Each key path holds a register. A newer op id overwrites it, and an older or equal one is ignored. Setting `["a","b"]` deletes an older register at `["a"]` or at `["a","b","c"]`. If an ancestor or descendant register is newer, the incoming set is dropped. So a map and a nested key never coexist. <!-- id:j1SSPPFr -->

The shape of the data decides what survives concurrent edits. [Metadata](../metadata.md) explains how to keep sets, maps and lists in attributes.

**The block tree is a move tree with RGA sibling lists.** Every parent, including the root and the trash, has an ordered list of children kept as an [RGA](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) sequence. A block is inserted after its `ref`. Concurrent inserts at the same ref are ordered by op id, and the newer op lands closer to the ref. For a block that has been moved several times, the **latest move wins** and earlier positions become invisible. A move that would make a block its own ancestor is ignored. Positions are stored as fractional-index strings so ordered traversal is cheap. A block that has state from `ReplaceBlock` but no visible position is returned as a **detached block**, and the apps still render it. Custom navigation menus are built this way. <!-- id:MCep09Yb -->

The block's own content is a register too. The newest `ReplaceBlock` by op id wins. The API reports each block's `revision`, the CID of the Change that last replaced it. <!-- id:IzPYDT3Y -->

## Producing a change <!-- id:CHSR_IXg -->

The [Seed app](../software/desktop.md) does not write operations by hand. It sends high-level edits to the [daemon](../software/daemon.md)'s `PrepareChange` (the `PrepareDocumentChange` API). The daemon loads the document, edits a working copy, and emits a minimal unsigned change: one `MoveBlocks` per run of blocks whose logical position changed (moves come first on purpose), then one `DeleteBlocks`, then one `SetAttributes` with every dirty attribute, then one `ReplaceBlock` per dirty block. Blocks created and deleted in the same change are dropped. `genesis`, `deps` (the current heads, sorted) and `depth` are computed from the loaded state. The [SDK](../build/sdk.md)'s `createChangeOps` and the [CLI](../build/cli.md) do not minimise anything. They encode the operations they are given. <!-- id:WjTbcGgU -->

# Heads and versions <!-- id:G27f_k6I -->

The **heads** of a document are the changes nothing else depends on yet. A **version** is the set of head CIDs, sorted as strings and joined with `.`. It is one CID for a linear history, and `cid1.cid2` when two writers edited at the same time and nobody has merged yet. In a URL it is the `v=` query parameter; see [URLs](./urls.md). The empty version means "latest". The `l` flag on a URL means "latest, at least this version". The daemon returns the latest version it knows when the flag is present. <!-- id:kBrUeH2J -->

The **latest** version of an address comes from the Refs. Take the address's highest generation, and merge the heads of every Ref seen for it. Two authorised writers whose Refs point at divergent heads produce a two-head version, and a reader merges by replaying both branches. A merge needs no special step. Any edit made on top of the merged state has both heads as `deps`, and its Ref names a single head again. A Ref may also name several heads directly; the daemon's `CreateRef` and the SDK's `createVersionRef` both accept a multi-head version. All heads of a version must share one genesis, and the daemon refuses to load a version that mixes documents. <!-- id:ieL4BU6i -->

# Refs <!-- id:QlF71M_R -->

A [Ref](../ref.md) names a `space` and a `path`, the document's `genesisBlob`, the `heads` it asserts, an optional `redirect`, a `generation` and a `visibility`. The [ref](../ref.md) type page is the reference for the fields. <!-- id:NMhGkIa4 -->

The signer must be the space owner or hold a matching [capability](./permissions.md). Otherwise the Ref is stashed and has no effect. Home documents may not carry a redirect or a tombstone. A valid Ref has a genesis and heads (a version), or a genesis and no heads (a tombstone or a redirect). <!-- id:A5koidGg -->

## Branching, deleting, moving, republishing <!-- id:-Wvu4eGw -->

- **Branching.** To make your own branch of a document, publish a Ref in your own space that points at the same genesis and at whichever heads you like. That creates a new address you control, with the whole history intact. The original author can later adopt your changes by pointing their Ref at your heads, without granting you anything. The CLI calls this `fork`. <!-- id:NGJZfzot -->
- **Deleting.** Publish a **tombstone**: a Ref with the genesis and no heads. The document is deleted when the newest tombstone is newer than the newest live Ref within the generation. A later live Ref un-deletes it. Deleting leaves data behind. The changes and the tombstone remain on every node that has them, because nobody in this system can be forced to forget. <!-- id:WMAn4gD- -->
- **Redirecting.** Publish a Ref with a genesis, no heads and a `redirect` target. Readers of the old address get a redirect result naming the [target](../ref/redirect-target.md). Without `republish` the Ref counts as a tombstone. With `republish` set it counts as a live Ref, so the address keeps showing the target's content under its own URL and appears in listings and search. <!-- id:y3Ovj784 -->
- **Moving.** Publish a Version Ref at the new address, then a Redirect Ref at the old one so links keep working. To make old links break, tombstone the old address instead. Links that name an exact version never break either way, because the changes are the same blobs. <!-- id:ZJc9ZlEt -->

## Generations and takeover <!-- id:dChb36Rs -->

A **generation** is one life of an address: a `(space, path, generation number, genesis)` tuple. The current state of a path is its **highest generation**. Within a generation, Refs merge heads and tombstones toggle deletion. Across generations, the higher number wins. To replace the document at a path with a different genesis, publish a Ref with a strictly higher generation. The daemon's `CreateRef` refuses to do this silently and asks for an explicit higher number. Clients use the current time in milliseconds as the generation for a new document, which keeps numbers increasing without coordination. An absent generation means zero, and any later generation overrides it. Editing a path that currently holds a redirect builds the change on the target's history and keeps the requested path as the address. The Seed app and the CLI then publish the Ref with a fresh generation, the new change's timestamp, so the edit takes the address over. When preparing such a change the daemon refuses redirect cycles and chains longer than five hops. <!-- id:xFGuQe34 -->

The writer chooses the generation number, and indexing validates it against nothing. Any authorised writer can publish a very high generation and take over a path they may write to. This is by design for a path you own. In shared spaces it is a limit; see [Integrity](./integrity.md). <!-- id:EfVrTA8h -->

# Where a document lives

A document lives at a path inside a [space](./spaces.md). [Spaces and paths](./spaces.md) covers the home document, the path rules and directories.

# Drafts <!-- id:MrunBE-p -->

The daemon has no draft concept. Drafts live in clients. The Seed app keeps drafts in its own storage, the CLI keeps them in a drafts directory as JSON, and [Seed Agents](../agent.md) have draft actions of their own. Publishing means signing a Change and a Ref and storing them. A draft can edit an existing address. Then it records the base version it started from, and the change it produces has that version's heads as `deps`. <!-- id:lknNH4a4 -->

# Working with documents <!-- id:DrL-PiOy -->

```sh <!-- id:_dbRdYGc -->
seed-cli document get hm://<uid>/<path>            # markdown with frontmatter; --json for blocks
seed-cli document get hm://<uid>/<path>?v=<ver>    # an exact version
seed-cli document create -f page.md -p /notes/sushi --name "Sushi"
seed-cli document update hm://<uid>/notes/sushi -f page.md   # diff by block id
seed-cli document delete hm://<uid>/notes/sushi              # tombstone
seed-cli document fork <source-url> <destination-url>        # branch
seed-cli document move <source-url> <destination-url>        # version ref + redirect
seed-cli document redirect <url> --to <target-url> [--republish]
seed-cli document changes <url>                              # the Change DAG
```

`document create` refuses to overwrite an existing address unless you pass `--force`. `document update` follows a redirect and takes the address over. The full reference is [the CLI guide](../build/cli.md). <!-- id:UWQg5ZJC -->

- The read side is `client.request('Resource', unpackHmId(url))` returning a document, a comment, a redirect, a tombstone or not-found, and `resolveDocumentState(client, id)` returning `{genesis, heads, headDepth, version}` for an edit. The write side follows the model above, in order: `createChangeOps({ops, genesisCid, deps, depth})`, then `createChange(unsignedBytes, signer)`, then `createVersionRef({space, path, genesis, version, generation}, signer)`, then `client.publish({blobs})`. `createTombstoneRef` and `createRedirectRef` build the other Ref kinds, and `createDocumentBlobs` runs the whole sequence for a new document. Give every blob its SHA-256 CID when publishing. Worked examples are in [the SDK guide](../build/sdk.md). <!-- id:-hB8ehHV -->
- `GET /api/Resource?id=<packed hm id>` returns the resolved document (or redirect, tombstone, not-found). <!-- id:R7yl5TAJ -->
- `GET /api/ListChanges?targetId=` lists the Change DAG with authors and deps. <!-- id:L437q60I -->
- [Seed Agents](../agent.md) [read](../agent/read.md) and [write](../agent/write.md) `hm://<space>/<path>` addresses, and the runtime signs the Change and the Ref with the agent's [granted](../agent/grants.md) key. See [Agents](../build/agents.md).
- The request catalogue is in [the Seed API guide](../build/web-api.md). The daemon's `Documents` service is in [the gRPC guide](../build/grpc.md).

# See also <!-- id:4OidKq_I -->

- [Signed Blobs](./blobs.md) for the envelope and CIDs. <!-- id:B_jDH2D4 -->
- [Spaces and paths](./spaces.md) for where documents live.
- [URLs](./urls.md) for how versions and blocks appear in links. <!-- id:CU4kqvBc -->
- [Blocks](./blocks.md) for the content model inside a document. <!-- id:hR3FaiGM -->
- [Permissions](./permissions.md) for who may publish a Ref. <!-- id:puNFPZjx -->
- [Privacy](./privacy.md) for private documents. <!-- id:-HzPh5hd -->
- [Comments](./comments.md) for discussion attached to a document. <!-- id:33TzTk0U -->
- Schema pages: [change](../change.md), [change/op](../change/op.md), [ref](../ref.md), [ref/redirect-target](../ref/redirect-target.md), [document](../document.md), [metadata](../metadata.md). <!-- id:Tl4S-9FB -->
- [Seed API](../build/web-api.md): `Resource`, `ListChanges`. <!-- id:CdT9G_e1 -->
