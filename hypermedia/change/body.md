---
name: Change Body
summary: The operations payload of a Change, an ordered list of ops plus an advisory count of the logical operations they represent.
schemaDefinition: ipfs://bafyreicjyyazofi3ntnkfu4hhwvu4lbgtbmqi6l4uehry3i54g366qawfq
---
The **change body** is where the editing happens in a [Change](../change.md): an ordered list of operations that the daemon applies one after another when it replays the [document](../protocol/documents.md). Everything else in a Change is bookkeeping about where the body fits in the history. <!-- id:66RF6xKw -->

This page defines the **change/body** struct, the payload inside a Change blob. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:c8Da_qa9 -->

`ops` is the list of [operations](./op.md), each a map tagged with a `type`. Order matters. Each op receives an id made of the Change's timestamp, its position in this list and the signer, and later ops in the same Change may refer back to earlier ones by position. `opCount` is a hint for consumers. Some ops are run-length encoded (one `MoveBlocks` can place many blocks), so the number of logical operations may exceed the number of list items. The daemon and the SDK write it, and nothing reads it today. <!-- id:G_hztZbt -->

A minimal body, which the daemon's `PrepareChange` emits for the Seed app, has moves first, then deletions, then one [SetAttributes](./op/set-attributes.md) for all metadata, then one [ReplaceBlock](./op/replace-block.md) per changed block. [Documents](../protocol/documents.md) explains why. <!-- id:nus6mgsa -->

# Shape <!-- id:BpgwjtEP -->

A **closed struct** with these fields: <!-- id:xndwO-1C -->
  - `opCount`: [integer](../integer.md) <!-- id:cRrknZYz -->
  - `ops`: list of [change/op](./op.md)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:5HwZMPHJ -->

**Generic** over `⟨Block⟩` (default [block](../block.md)). <!-- id:8rrUhiVB -->

# Depends on <!-- id:C3Z8Yr0_ -->

- [block](../block.md) <!-- id:JW5qQu6z -->
- [change/op](./op.md) <!-- id:10QhAwJr -->
- [integer](../integer.md) <!-- id:f2oL511e -->

# See also

- [change](../change.md): the blob that carries the body.
- [change/op](./op.md): the operations and how each mutates a document.
- [Documents](../protocol/documents.md): op ids and replay.
- [Generic](../schema/generic.md): how the body is generic over its block type.
