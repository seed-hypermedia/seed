---
name: Change Body
summary: The operations payload of a Change, an ordered list of ops plus an advisory count of the logical operations they represent.
schemaDefinition: ipfs://bafyreicjyyazofi3ntnkfu4hhwvu4lbgtbmqi6l4uehry3i54g366qawfq
---
The body of a [Change](../change.md) is where the editing happens: an ordered list of operations that the daemon applies one after another when it replays the document. Everything else in a Change is bookkeeping about where the body fits in the history. <!-- id:66RF6xKw -->

This page defines the **change/body** struct, the payload inside a Change blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:c8Da_qa9 -->

`ops` is the list of [operations](./op.md), each a map tagged with a `type`. Order matters: each op receives an id made of the Change's timestamp, its position in this list and the signer, and later ops in the same Change may refer back to earlier ones by position. `opCount` is a hint for consumers: some ops are run-length encoded (one `MoveBlocks` can place many blocks), so the number of logical operations may exceed the number of list items. The daemon writes it and nothing reads it today. <!-- id:G_hztZbt -->

A minimal body emitted by the Seed app or the SDK has moves first, then deletions, then one `SetAttributes` for all metadata, then one `ReplaceBlock` per changed block; [Documents](../protocol/documents.md) explains why. <!-- id:nus6mgsa -->

# Shape <!-- id:BpgwjtEP -->

A **closed struct** with these fields: <!-- id:xndwO-1C -->
  - `opCount` — [integer](../integer.md) <!-- id:cRrknZYz -->
  - `ops` — list of [change/op](./op.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:5HwZMPHJ -->

**Generic** over `⟨Block⟩` (default [block](../block.md)). <!-- id:8rrUhiVB -->

# Depends on <!-- id:C3Z8Yr0_ -->

- [block](../block.md) <!-- id:JW5qQu6z -->
- [change/op](./op.md) <!-- id:10QhAwJr -->
- [integer](../integer.md) <!-- id:f2oL511e -->
