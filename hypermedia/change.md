---
name: Change
summary: A signed delta on a document that links the changes it depends on into a causal graph and carries the operations that mutate the document's content and metadata.
---
A **Change** is the unit of editing in Hypermedia: one signed step in a [document](./protocol/documents.md)'s history. Each Change says which earlier Changes it builds on and lists the operations that turn that state into the new one. Replaying a document's Changes in dependency order, on any machine, produces the same document. Every Change is signed, so the author of every step is known. <!-- id:BGe4AnmS -->

This page defines the **change** blob type, a Hypermedia network blob that extends the signed [blob](./blob.md) envelope. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and sign values of this type. <!-- id:v0dbkIbB -->

# Fields

A Change adds four fields to the signed [blob](./blob.md) envelope:

<!-- id:HnE1cME2 -->
| key <!-- col:jyGiAoPG --> | meaning <!-- col:5bfVXhR3 --> <!-- id:Qpaz2gbv --> |
| --- | --- |
| `genesis` | CID of the document's first Change. Absent on the genesis change itself. <!-- id:WyKF4Y5z --> |
| `deps` | the parent changes: the heads the author saw when editing. The daemon sorts them by CID bytes. Ingest does not check the order. <!-- id:LdORluuw --> |
| `depth` | one more than the largest depth among the deps; zero for the genesis. <!-- id:TXe9UZwa --> |
| `body` | `{opCount?, ops}`: the operations. `opCount` is an advisory count that nothing reads. <!-- id:v8tQmkjv --> |

The daemon enforces one invariant when a Change is indexed: either all three of `genesis`, a non-empty `deps` and a positive `depth` are present, or none of them are. Anything else is rejected. Replaying the document adds more requirements: the first change applied is the genesis, every dependency was applied first, the timestamp and the depth are strictly greater than each dependency's, a signer's changes are applied in non-decreasing timestamp order, and no change is stamped 40 seconds or more ahead of the replaying node's clock. <!-- id:lpmLMobZ -->

The genesis Change is the identity of the document. [Documents](./protocol/documents.md) explains that rule and the deterministic genesis of a home document.

# Operations <!-- id:6w7U1eNa -->

The body carries a list of operations, each a map with a `type` tag. Unknown fields inside an operation are an error. <!-- id:f_P_VXyZ -->

<!-- id:eIyX2DTu -->
| op <!-- col:2BX7piQd --> | fields <!-- col:aSrkyUZ_ --> | effect <!-- col:z3jCNyAO --> <!-- id:ADdlv84e --> |
| --- | --- | --- |
| `SetAttributes` | `block?`, `attrs: [{key: [string], value}]` | set document [metadata](./metadata.md) by key path. `block` must be empty, and per-block attributes go inside `ReplaceBlock`. <!-- id:iAiBwuAV --> |
| `ReplaceBlock` | `block` | replace the whole state of one [block](./protocol/blocks.md): id, type, text, link, annotations and attributes. <!-- id:3bmcv1Ph --> |
| `MoveBlocks` | `parent?`, `blocks: [id]`, `ref?` | place a run of sibling blocks under `parent` (empty means the root) after the position `ref` (empty means the start of the list). <!-- id:xw9z3ofB --> |
| `DeleteBlocks` | `blocks: [id]` | move the blocks to the trash. <!-- id:W1iI7JY5 --> |
| `SetKey` | `key`, `value` | deprecated flat metadata set; still accepted. <!-- id:3wXyzl0x --> |

Attribute values are strings, booleans, integers up to 2^53−1, null (meaning deleted), or lists (only when the change is built by the SDK or CLI: the daemon's `PrepareDocumentChange` has no list value). Each page under [change/op](./change/op.md) has the exact schema. <!-- id:iy1o91rD -->

# Op ids and ordering <!-- id:k1UO9rJB -->

Every operation gets an id `(ts, idx, actor)`: the change's timestamp, the operation's position counter inside the change, and a 56-bit number derived from the signer's principal. Op ids are compared in that order. On the wire, `MoveBlocks.ref` names another op id as `[ts, idx, actor]`, or as a single `[idx]` meaning "op number idx of this same change", or is empty for "start of list". <!-- id:6JebMC6C -->

One quirk is visible on the wire. Inside a multi-block `MoveBlocks`, `DeleteBlocks` or `SetAttributes`, the counter advances by the element's index, so an operation over n blocks uses about n²/2 ids. Existing changes reference ops by these numbers, so the numbering is part of the wire format. The counter is capped at 2^31−1 and the timestamp at 2^48−1. A change that overflows is rejected, and the node does not crash. <!-- id:6hr5BdTT -->

# Changes and Refs

A Change alone does not change what readers see. A [Ref](./ref.md) that points at the head Changes asserts the document's current state at an address. A Change that no Ref reaches is a proposal, and that is how branches and [open editing](./why/open-editing.md) work. [Documents](./protocol/documents.md) has the rules for ordering concurrent Changes, producing minimal Changes from an edit, and merging heads. <!-- id:-6QfT9mG -->

# See also <!-- id:Vocl2sK5 -->

- [Documents](./protocol/documents.md): the change graph, op ids, the CRDT rules, versions and merging. <!-- id:pWQZEoIu -->
- [Signed Blobs](./protocol/blobs.md): the envelope and CIDs. <!-- id:yzzrd3BR -->
- [change/body](./change/body.md) and [change/op](./change/op.md): the operations. <!-- id:gPH5jraA -->
- [Seed API](./build/web-api.md): `ListChanges` lists a document's Changes. <!-- id:mYSOepZn -->
- [ref](./ref.md): the blob that points an address at a Change's heads. <!-- id:gBQE-w7g -->

# Pages in this section <!-- id:mxMDTMXw attrs:{"childrenType":"Grid","columnCount":3} -->

<./change/body.md> <!-- id:UDdFNq4s type:Embed attrs:{"view":"Card"} -->

<./change/op.md> <!-- id:YSbtiDY2 type:Embed attrs:{"view":"Card"} -->
