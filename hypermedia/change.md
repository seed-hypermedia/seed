---
name: Change
summary: A signed delta on a document that links the changes it depends on into a causal graph and carries the operations that mutate the document's content and metadata.
schemaDefinition: ipfs://bafyreie3extkcrek4pduyrezyrad3aqddw3tcaijeveeectku5zih3qrgi
---
A Change is the unit of editing in Hypermedia: one signed step in a document's history. Each Change says which earlier Changes it builds on and lists the operations that turn that state into the new one. Replaying a document's Changes in dependency order, on any machine, produces the same document, and because every Change is signed the authorship of every step is known. <!-- id:BGe4AnmS -->

This page defines the **change** blob type, a Hypermedia network blob that extends the signed [blob](./blob.md) envelope. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and sign values of this type. <!-- id:v0dbkIbB -->

`genesis` names the document's first Change, which is the document's identity; `deps` are the heads the author saw, sorted by CID; `depth` is one more than the deepest dependency; and `body` holds the operations. The genesis Change of an ordinary document is simply its first content Change, carrying none of `genesis`, `deps` or `depth`. The daemon rejects a Change that has some but not all of the three, and at replay it requires that every dependency was applied first with a smaller timestamp and depth. The home document of a space is the one exception to "first content change is the genesis": its genesis is an empty Change with `ts: 0`, deterministic for the account key. <!-- id:m48rXg09 -->

A Change alone does not change what readers see. The document's current state at an address is asserted by a [Ref](./ref.md) that points at the head Changes; a Change nobody's Ref reaches is a proposal, which is how branches and open editing work. The rules for ordering concurrent Changes, producing minimal Changes from an edit, and merging heads are in [Documents](./protocol/documents.md). <!-- id:-6QfT9mG -->

# Shape <!-- id:NQM1VhDF -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:WtuABanO -->
  - `type`: `"Change"` <!-- id:vuVh1zRN -->
  - `genesis`: [cid](./cid.md) <!-- id:OjyRoI0Z -->
  - `deps`: list of [cid](./cid.md) <!-- id:14sUK5dG -->
  - `depth`: [integer](./integer.md) <!-- id:WymiRSox -->
  - `body`: [change/body](./change/body.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:uBgg3XsN -->

**Generic** over `⟨Block⟩` (default [block](./block.md)). <!-- id:R7cLitDd -->

# Depends on <!-- id:04pSmVGM -->

- [blob](./blob.md) <!-- id:WMAGmaBA -->
- [block](./block.md) <!-- id:FapoGwga -->
- [change/body](./change/body.md) <!-- id:_jOGY6LF -->
- [cid](./cid.md) <!-- id:63xfnTGa -->
- [integer](./integer.md) <!-- id:fvXmpXcE -->

# See also <!-- id:Vocl2sK5 -->

- [Documents](./protocol/documents.md): the change graph, op ids, the CRDT rules, versions and merging. <!-- id:pWQZEoIu -->
- [Signed Blobs](./protocol/blobs.md): the envelope and CIDs. <!-- id:yzzrd3BR -->
- [change/body](./change/body.md) and [change/op](./change/op.md): the operations. <!-- id:gPH5jraA -->
- [ListChanges](./rpc/list-changes.md): the read model that lists a document's Changes. <!-- id:mYSOepZn -->
