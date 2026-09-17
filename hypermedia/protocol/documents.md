---
name: Documents
summary: A Hypermedia document is a graph of signed Change blobs whose current state is asserted by a Ref, and this page explains the operations, the ordering rules, versions, generations, deletion, redirects, paths and drafts.
---
A document in Hypermedia is not a file that gets overwritten. It is a history: a chain of small signed edits, each one pointing at the edits it builds on, so that any reader can replay the chain and arrive at the same page. A separate signed note, the Ref, says which point in that history a given address currently shows. This is what lets several people edit without a central server, lets anyone keep a fork, and lets a link name an exact version forever.

Read [Signed Blobs](./blobs.md) first if the words blob, CID and signature are new. This page covers the change-based kind of resource, the document; comments, contacts and profiles are snapshot blobs and are described in [Comments](./comments.md) and [Identity](./identity.md).

# The mental model

```
build operations → create Change → sign Change → create Ref → sign Ref → publish blobs → daemon indexes → peers sync
```

A **Change** is a blob (data) that describes the creation or mutation of a document. Each change has three ingredients: **operations**, a list of additions, modifications or removals of document state; **dependencies**, the other changes that must be applied before this one makes sense; and **authorship**, the signer, the signature and the timestamp. Because a change links to its dependencies, the changes form a graph with no cycles, and a change generally represents a version of the document. As the document evolves the graph grows, and because a change may have several dependencies you can merge a branch back into the main line.

Changes do not tell the whole story, because a change can exist without affecting what readers see. The **Ref** blob asserts the current version of a document at an address: a location (space and path), authorship, and the active version (the change CIDs that are the current heads). To read a document, find the newest Ref for the address, check that its signer is allowed to write there, and replay the changes it points at. A Ref is the object that makes a document appear at an `hm://` address at all; without an indexed Ref the changes exist as raw blobs but no document is listed.

# Changes

A [Change](../change.md) adds four fields to the [signed envelope](./blobs.md):

| key | meaning |
| --- | --- |
| `genesis` | CID of the document's first Change. Absent on the genesis change itself. |
| `deps` | the parent changes, i.e. the heads the author saw when editing. Sorted by CID. |
| `depth` | one more than the largest depth among the deps; zero for the genesis. |
| `body` | `{opCount?, ops}`: the operations. `opCount` is an advisory count that nothing reads today. |

The daemon enforces one invariant when a Change is indexed: either all three of `genesis`, a non-empty `deps` and a positive `depth` are present, or none of them are. Anything else is rejected. When the document is replayed it additionally requires that the first change applied is the genesis, every dependency was applied first, the timestamp and the depth are strictly greater than each dependency's, and a signer's changes are in timestamp order.

**The genesis is the identity of the document.** Two Refs that name the same genesis are talking about the same document, wherever they place it. For an ordinary document the first content Change is the genesis: there is no separate empty genesis blob. The one exception is the home document of a space, whose genesis is an empty Change with `ts: 0` signed by the account key. It is deterministic on purpose, so every device of an account derives the same home genesis. Do not reuse it for any other document, or that document merges with the home document.

## Operations

The body carries a list of operations, each a map with a `type` tag. Unknown fields inside an operation are an error.

| op | fields | effect |
| --- | --- | --- |
| `SetAttributes` | `block?`, `attrs: [{key: [string], value}]` | set document [metadata](../metadata.md) by key path. Today `block` must be empty: per-block attributes go inside `ReplaceBlock`. |
| `ReplaceBlock` | `block` | replace the whole state of one [block](../block.md): id, type, text, link, annotations and attributes. |
| `MoveBlocks` | `parent?`, `blocks: [id]`, `ref?` | place a run of sibling blocks under `parent` (empty means the root) after the position `ref` (empty means the start of the list). |
| `DeleteBlocks` | `blocks: [id]` | move the blocks to the trash. |
| `SetKey` | `key`, `value` | deprecated flat metadata set; still accepted. |

Attribute values are strings, booleans, integers up to 2^53−1, or null (meaning deleted). Each page under [change/op](../change/op.md) has the exact schema.

## Op ids and ordering

Every operation gets an id `(ts, idx, actor)`: the change's timestamp, the operation's position counter inside the change, and a 56-bit number derived from the signer's principal. Op ids are compared in that order. `MoveBlocks.ref` names another op id on the wire as `[ts, idx, actor]`, or as a single `[idx]` meaning "op number idx of this same change", or empty for "start of list".

One wire-visible quirk: inside a multi-block `MoveBlocks`, `DeleteBlocks` or `SetAttributes` the counter advances by the element's index, so an operation over n blocks consumes roughly n²/2 ids. Existing changes reference ops by these numbers, so it cannot be corrected without a versioned protocol change. The counter is capped at 2^31−1 and the timestamp at 2^48−1; a change that overflows is rejected rather than crashing the node.

## How concurrent edits resolve

The daemon replays a document's changes in dependency order and resolves conflicts with two small [CRDTs](https://crdt.tech/), which are rules that make every replica arrive at the same state whatever order the changes arrived in.

**Metadata is last-writer-wins by op id, with structural pruning.** Each key path holds a register; a newer op id overwrites, an older or equal one is ignored. Setting `["a","b"]` deletes an older register at `["a"]` or at `["a","b","c"]`, and if an ancestor or descendant register is newer the incoming set is dropped, so a map and a nested key never coexist.

**The block tree is a move tree with RGA sibling lists.** Every parent, including the root and the trash, has an ordered list of children kept as an [RGA](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) sequence: a block is inserted after its `ref`, and concurrent inserts at the same ref are ordered by op id, the newer op landing closer to the ref. For a block that has been moved several times the **latest move wins** and earlier positions become invisible; a move that would make a block its own ancestor is ignored. Positions are materialised as fractional-index strings so ordered traversal is cheap. A block that has state from `ReplaceBlock` but no visible position is returned as a **detached block** and is still rendered by the apps; custom navigation menus are built this way.

The block's own content is a register too: the newest `ReplaceBlock` by op id wins. The API reports each block's `revision`, the CID of the Change that last replaced it.

## Producing a change

Clients do not hand-write operations. They load the document, mutate a working copy, and commit; the SDK and the daemon then emit a minimal change: one `MoveBlocks` per run of blocks whose logical position changed (moves come first on purpose), then one `DeleteBlocks`, then one `SetAttributes` with every dirty attribute, then one `ReplaceBlock` per dirty block. Blocks created and deleted in the same change are dropped. `genesis`, `deps` (the current heads, sorted) and `depth` are computed from the loaded state.

# Heads and versions

The **heads** of a document are the changes nothing else depends on yet. A **version** is the set of head CIDs, sorted as strings and joined with `.`: one CID for a linear history, `cid1.cid2` when two writers edited concurrently and nobody has merged yet. In a URL it is the `v=` query parameter; see [URLs](./urls.md). The empty version means "latest". The `l` flag on a URL means "latest, at least this version"; today the daemon simply returns the latest it knows.

The **latest** version of an address is derived from the Refs: take the address's highest generation, and merge the heads of every Ref seen for it. Two authorised writers whose Refs point at divergent heads produce a two-head version, and a reader merges by replaying both branches. Publishing a merge is not a special act: any edit made on top of the merged state has both heads as `deps`, and its Ref names a single head again. The daemon refuses to create a Ref for a document that currently has more than one head, so a merge always goes through an edit. A version may span generations only if all its heads share a genesis, which is another way of saying a version belongs to one document.

# Refs

A [Ref](../ref.md) adds these fields to the envelope:

| key | meaning |
| --- | --- |
| `space` | the account whose namespace the path lives in; omitted when it equals `signer`. |
| `path` | the path inside the space; empty for the home document. Must start with `/`, must not end with `/`, and may not contain quotes, backslashes or control characters. |
| `genesisBlob` | the genesis of the document. Required by the indexer, although the daemon's own comment marks it as a candidate for deprecation. |
| `heads` | the version this Ref asserts. Empty for a tombstone or a redirect. |
| `redirect` | `{space?, path?, republish?}`: where readers should go instead. |
| `generation` | a number that orders successive lives of the address; see below. |
| `visibility` | empty for public, `"Private"` for private; see [Privacy](./privacy.md). |
| `capability` | informational CID of the grant the signer relied on. The daemon never sets it and ignores it for authorisation; publish the Capability blob itself instead. |

The signer must be the space owner or hold a matching [capability](./permissions.md); otherwise the Ref is stashed and has no effect. Home documents may not carry a redirect or a tombstone. A valid Ref has a genesis and heads (a version), or a genesis and no heads (a tombstone or a redirect).

## Branching, deleting, moving, republishing

- **Branching.** To make your own branch of a document, publish a Ref in your own space that points at the same genesis and at whichever heads you like. That creates a new address you control, with the whole history intact, and the original author can later adopt your changes by pointing their Ref at your heads without granting you anything. The CLI calls this `fork`.
- **Deleting.** Publish a **tombstone**: a Ref with the genesis and no heads. The document is deleted when the newest tombstone is newer than the newest live Ref within the generation, and a later live Ref un-deletes it. Deleting leaves data behind: the changes and the tombstone remain on every node that has them, which is the price of a system where nobody can be forced to forget.
- **Redirecting.** Publish a Ref with no heads and a `redirect` target. Readers of the old address get a redirect result naming the target. If the redirect is also the newest live Ref, i.e. `republish` is set, the address keeps showing the target's content under its own URL, appears in listings and search, and is not a tombstone.
- **Moving.** Publish a Version Ref at the new address, then a Redirect Ref at the old one so links keep working; or tombstone the old one if you want them to break. Links that name an exact version never break either way, because the changes are the same blobs.

## Generations and takeover

A **generation** is one life of an address: a `(space, path, generation number, genesis)` tuple. The current state of a path is its **highest generation**. Within a generation Refs merge heads and tombstones toggle deletion; across generations the higher number simply wins. To replace the document at a path with a different genesis, publish a Ref with a strictly higher generation; the daemon's `CreateRef` refuses to do it silently and asks for an explicit higher number. Clients use the current time in milliseconds as the generation for a new document, which keeps numbers increasing without coordination; absent means zero, which any later generation overrides. Editing a path that currently holds a redirect builds the change on the target's history, keeps the requested path as the address, and publishes a Ref at `redirect generation + 1`, so the edit takes the address over. Cycles and redirect chains longer than a small hop limit are refused.

Generation numbers are chosen by the writer and are not validated against anything at index time; any authorised writer can publish a very high generation and take over a path they are allowed to write to. That is by design for a path you own, and a limit to keep in mind for shared spaces; see [Integrity](./integrity.md).

# Spaces, paths and the home document

A **space** is a public key. Every address is `hm://<space>/<path>`, and the home document is the address with an empty path. Paths are plain strings; `/cars` and `/cars/honda` are two independent documents, and the daemon keeps no tree of documents. A **directory** listing is a prefix query over addresses, and a parent gains no authority over its children from the path alone. The exceptions are capabilities, which apply by path segment (a grant at `/a` covers `/a/b` but not `/ab`), and typed documents, whose `childAttributesSchema` applies to children by path; see [Typed documents](../schema/typed-documents.md).

Two path conventions matter to clients. A first segment that parses as a TSID (14 or 15 base58 characters) is treated by the daemon as a comment or contact record rather than a document, and a private document must use a single path segment. The apps also reserve a leading `-` for local draft paths.

# Drafts

The daemon has no draft concept. A draft is a client-side thing: the Seed app keeps drafts in its own storage, the CLI keeps them in a drafts directory as JSON, and Seed Agents have draft actions of their own. Publishing is the act of signing a Change and a Ref and storing them. A draft can be an edit of an existing address, in which case it records the base version it started from, and the change it produces has that version's heads as `deps`.

# Working with documents

## In the Seed app

Every edit you save creates a draft; Publish signs a Change and a Ref with the selected account and pushes them. The options menu offers move and delete (a tombstone); the activity panel lists versions (the Refs) and opens any of them; the version graph offers an "Exact version" link. With the Developer Tools experiment on, "Inspect Document" shows the underlying blobs.

## CLI

```sh
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

`document create` refuses to overwrite an existing address unless `--force`; `document update` follows a redirect and takes the address over. The full reference is [the CLI page](../build/cli.md).

## SDK

The read side is `client.request('Resource', {id})` returning a document, a comment, a redirect, a tombstone or not-found, and `resolveDocumentState(client, id)` returning `{genesis, heads, headDepth}` for an edit. The write side follows the model above: `createChangeOps({ops, genesisCid, deps, depth})` → `createChange(unsignedBytes, signer)` → `createVersionRef({space, path, genesis, version, generation}, signer)` → `client.publish({blobs})`, with `createTombstoneRef` and `createRedirectRef` for the other Ref kinds, and `createDocumentBlobs` doing the whole sequence for a new document. Give every blob its SHA-256 CID when publishing. Worked examples are in [the SDK guide](../build/sdk.md).

## Web API

- `GET /api/Resource?id=<packed hm id>` returns the resolved document (or redirect, tombstone, not-found).
- `GET /api/ResourceMetadata?id=` returns just the metadata.
- `GET /api/ListChanges?targetId=` lists the Change DAG with authors and deps.
- `POST /api/PrepareDocumentChange` builds an unsigned Change from high-level edits for a client to sign, and `POST /api/PublishBlobs` stores signed blobs.
- `GET https://<site>/<path>.md` and `.json` export a document.

The catalogue is in [the Seed API guide](../build/web-api.md); the daemon's gRPC `Documents` service, with `CreateRef`, `CreateDocumentChange` and friends, is in [the gRPC guide](../build/grpc.md).

## Agents

Seed Agents use `read hm://<space>/<path>` for a document as markdown (or JSON), with `?v=` for a version and the suffixes `/:directory` and `/:attributes`, and `write hm://<space>/<path>` with `options.action` set to `document.create` (the default), `update`, `move {toPath}`, `redirect {toUrl}`, `delete` or `fork {fromUrl}`; the runtime builds and signs the Change and Ref with the agent's granted key. Agents are advised to work draft-first (`draft.*` actions) so a multi-block edit publishes atomically. An external agent with the seed-cli skill uses the CLI commands above. See [Agents](../build/agents.md) and the [read](../agent/read.md) and [write](../agent/write.md) verbs.

# Where this is going

As of September 2026 the team is designing a successor blob layout (working name HM26) in which a document's state could also be published as a snapshot with a Ref to the previous state, and where the same Ref mechanism would address schemas and other resources. Nothing of that ships; the model on this page is what the daemon implements. The dated notes are in [Roadmap](./roadmap.md).

# See also

- [Signed Blobs](./blobs.md) for the envelope and CIDs; [URLs](./urls.md) for how versions and blocks appear in links.
- [Blocks](./blocks.md) for the content model inside a document.
- [Permissions](./permissions.md) for who may publish a Ref; [Privacy](./privacy.md) for private documents.
- Schema pages: [change](../change.md), [change/op](../change/op.md), [ref](../ref.md), [ref/redirect-target](../ref/redirect-target.md), [document](../document.md), [metadata](../metadata.md).
- Read models: [Resource](../rpc/resource.md), [ListChanges](../rpc/list-changes.md).
