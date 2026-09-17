---
name: Change
summary: A signed delta on a document that links the changes it depends on into a causal graph and carries the operations that mutate the document's content and metadata.
---
A **Change** is the unit of editing in Hypermedia: one signed step in a [document](./protocol/documents.md)'s history. Each Change says which earlier Changes it builds on and lists the operations that turn that state into the new one. Replaying a document's Changes in dependency order, on any machine, produces the same document. Every Change is signed, so the author of every step is known. <!-- id:BGe4AnmS -->

This page defines the **change** blob type, a Hypermedia network blob that extends the signed [blob](./blob.md) envelope. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and sign values of this type. <!-- id:v0dbkIbB -->

`genesis` names the document's first Change, which is the document's identity. `deps` are the heads the author saw, sorted by [CID](./cid.md). `depth` is one more than the deepest dependency. `body` holds the [operations](./change/op.md). The genesis Change of an ordinary document is its first content Change, and it carries none of `genesis`, `deps` or `depth`. The daemon rejects a Change that has some but not all of the three. At replay it requires that every dependency was applied first with a smaller timestamp and depth. The home document of a space is the one exception to "the first content Change is the genesis": its genesis is an empty Change with `ts: 0`, deterministic for the account key. <!-- id:m48rXg09 -->

A Change alone does not change what readers see. A [Ref](./ref.md) that points at the head Changes asserts the document's current state at an address. A Change that no Ref reaches is a proposal, and that is how branches and [open editing](./why/open-editing.md) work. [Documents](./protocol/documents.md) has the rules for ordering concurrent Changes, producing minimal Changes from an edit, and merging heads. <!-- id:-6QfT9mG -->

# See also <!-- id:Vocl2sK5 -->

- [Documents](./protocol/documents.md): the change graph, op ids, the CRDT rules, versions and merging. <!-- id:pWQZEoIu -->
- [Signed Blobs](./protocol/blobs.md): the envelope and CIDs. <!-- id:yzzrd3BR -->
- [change/body](./change/body.md) and [change/op](./change/op.md): the operations. <!-- id:gPH5jraA -->
- [ListChanges](./rpc/list-changes.md): the read model that lists a document's Changes. <!-- id:mYSOepZn -->
- [ref](./ref.md): the blob that points an address at a Change's heads. <!-- id:gBQE-w7g -->
