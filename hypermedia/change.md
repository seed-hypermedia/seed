---
name: Change
summary: A signed delta on a document that links the changes it depends on into a causal graph and carries the operations that mutate the document's content and metadata.
---
A **Change** is one signed edit to a [document](./protocol/documents.md). Each Change says which earlier Changes it builds on. It also lists the operations that turn that state into the new one. Any machine that replays a document's Changes in dependency order gets the same document. Every Change is signed, so you know who made each step. <!-- id:BGe4AnmS -->

This page defines the **change** blob type. A Change is a [blob](./protocol/blobs.md) that starts with the signed [blob envelope](./blob.md). The formal schema is attached to this document as the `schemaDefinition` key of its metadata. So the app can show the schema and sign values of this type. <!-- id:v0dbkIbB -->

# Fields

A Change adds these fields to the signed [blob](./blob.md) envelope:

<!-- id:HnE1cME2 -->
| key <!-- col:jyGiAoPG --> | meaning <!-- col:5bfVXhR3 --> <!-- id:Qpaz2gbv --> |
| --- | --- |
| `genesis` | [CID](./cid.md) of the document's first Change. Absent on the genesis change itself. <!-- id:WyKF4Y5z --> |
| `deps` | the parent changes: the heads the author saw when editing. The [daemon](./software/daemon.md) sorts them by CID bytes. Ingest does not check the order. <!-- id:LdORluuw --> |
| `depth` | one more than the largest depth among the deps; zero for the genesis. <!-- id:TXe9UZwa --> |
| `body` | `{opCount?, ops}`: the operations. `opCount` is an advisory count that nothing reads. <!-- id:v8tQmkjv --> |
| `message` | optional human-readable description of the Change, like a commit message. Absent when empty. |

The daemon checks two rules when it indexes a Change. Either all three of these are present, or none of them: `genesis`, a non-empty `deps`, and a positive `depth`. And the Change's timestamp and depth are strictly greater than those of every dependency. A Change that breaks either rule is invalid, and the daemon never indexes it. A Change that arrives before its dependencies waits until they arrive. Because every Change is newer than the Changes it builds on, timestamp order is also a valid replay order. <!-- id:lpmLMobZ -->

Replaying the document adds more rules:

- The first Change applied is the genesis.
- Every dependency is applied before the Change that names it.
- The timestamp and the depth are strictly greater than each dependency's.
- One signer's Changes are applied in timestamp order, never going back in time.
- No Change is stamped 40 seconds or more ahead of the clock of the node that replays it.

The genesis Change is the identity of the document. [Documents](./protocol/documents.md) explains that rule. It also explains why the genesis of a [home document](./protocol/spaces.md) is the same on every device.

# Operations <!-- id:6w7U1eNa -->

The body carries a list of operations. Each one is a map with a `type` tag. An unknown field inside an operation is an error. <!-- id:f_P_VXyZ -->

<!-- id:eIyX2DTu -->
| op <!-- col:2BX7piQd --> | fields <!-- col:aSrkyUZ_ --> | effect <!-- col:z3jCNyAO --> <!-- id:ADdlv84e --> |
| --- | --- | --- |
| `SetAttributes` | `block?`, `attrs: [{key: [string], value}]` | set document [metadata](./metadata.md) by key path. `block` must be empty, and per-block attributes go inside `ReplaceBlock`. <!-- id:iAiBwuAV --> |
| `ReplaceBlock` | `block` | replace the whole state of one [block](./protocol/blocks.md): id, type, text, link, annotations and attributes. <!-- id:3bmcv1Ph --> |
| `MoveBlocks` | `parent?`, `blocks: [id]`, `ref?` | place a run of sibling blocks under `parent` (empty means the root) after the position `ref` (empty means the start of the list). <!-- id:xw9z3ofB --> |
| `DeleteBlocks` | `blocks: [id]` | move the blocks to the trash. <!-- id:W1iI7JY5 --> |
| `SetKey` | `key`, `value` | deprecated flat metadata set; still accepted. <!-- id:3wXyzl0x --> |

An attribute value is a string, a boolean, an integer up to 2^53−1, or null (meaning deleted). The [SDK](./build/sdk.md) and the [CLI](./build/cli.md) can also write a list. The daemon's `PrepareDocumentChange` has no list value. Each page under [change/op](./change/op.md) has the exact schema. <!-- id:iy1o91rD -->

# Op ids and ordering <!-- id:k1UO9rJB -->

Every operation gets an id `(ts, idx, actor)`. `ts` is the Change's timestamp. `idx` is the operation's position counter inside the Change. `actor` is a 56-bit number derived from the signer's [principal](./principal.md). Op ids are compared in that order. On the wire, `MoveBlocks.ref` names another op id in one of three ways: `[ts, idx, actor]`; a single `[idx]`, meaning "op number idx of this same Change"; or empty, meaning "start of list". <!-- id:6JebMC6C -->

One detail of the counter is visible on the wire. You only need it if you write your own encoder. The SDK does it for you. Inside a `MoveBlocks`, `DeleteBlocks` or `SetAttributes` that covers several blocks, the counter advances by the element's index. So an operation over n blocks uses about n²/2 ids. Stored Changes point at ops by these numbers, so the numbering is part of the wire format. The counter may not pass 2^31−1, and the timestamp may not pass 2^48−1. The daemon rejects a Change that goes over, and the node does not crash. <!-- id:6hr5BdTT -->

# Changes and Refs

A Change alone does not change what readers see. A [Ref](./ref.md) points at the head Changes, and so says what the document at an address is. A Change that no Ref reaches is a proposal. This is how branches and [open editing](./why/open-editing.md) work. [Documents](./protocol/documents.md) has the rules for ordering Changes made at the same time, for making a small Change from an edit, and for merging heads. <!-- id:-6QfT9mG -->

# See also <!-- id:Vocl2sK5 -->

- [Documents](./protocol/documents.md): the change graph, op ids, the CRDT rules, versions and merging. <!-- id:pWQZEoIu -->
- [Signed Blobs](./protocol/blobs.md): the envelope and CIDs. <!-- id:yzzrd3BR -->
- [change/body](./change/body.md) and [change/op](./change/op.md): the operations. <!-- id:gPH5jraA -->
- [Seed API](./build/web-api.md): `ListChanges` lists a document's Changes. <!-- id:mYSOepZn -->
- [ref](./ref.md): the blob that points an address at a Change's heads. <!-- id:gBQE-w7g -->

# Pages in this section <!-- id:mxMDTMXw attrs:{"childrenType":"Grid","columnCount":3} -->

<./change/body.md> <!-- id:UDdFNq4s type:Embed attrs:{"view":"Card"} -->

<./change/op.md> <!-- id:YSbtiDY2 type:Embed attrs:{"view":"Card"} -->
