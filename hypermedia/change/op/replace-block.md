---
name: ReplaceBlock Op
summary: The operation that sets the full state of one block, its id, type, text, link, annotations and attributes, where the newest replacement by op id wins.
schemaDefinition: ipfs://bafyreievwi7m47efoyfeq5545mlhp6f3dy45zbzmeuq7atew6d4vcq5uk4
---
**ReplaceBlock** is the only way content gets into a [document](../../protocol/documents.md). It carries a whole [block](../../block.md), never a diff. The daemon keeps a register per block id, and the newest ReplaceBlock by op id is the block's state. <!-- id:z4vmPqIg -->

This page defines the **change/op/replace-block** operation inside a [Change body](../body.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:W0uu_eZA -->

`block` is a block map: `id`, `type`, optional `text`, `link` and `annotations`. Any other keys are the block's attributes, inlined at the top level. Older encodings with a nested `attributes` map are still accepted. A block that is replaced but never positioned by [MoveBlocks](./move-blocks.md) is a detached block. It is kept, returned by the API, and rendered by the apps outside the main tree, which is how custom [navigation](../../metadata/navigation-item.md) is stored. The API reports each block's `revision`, the CID of the [Change](../../change.md) whose ReplaceBlock currently defines it. The operation is generic over the block type, so a schema can pin a stricter block model. See [Blocks](../../protocol/blocks.md) for what goes inside a block. <!-- id:ztxKecj4 -->

# Shape <!-- id:2s8VcML2 -->

A **closed struct** with these fields: <!-- id:Sym_gHmT -->
  - `type` _(required)_: `"ReplaceBlock"` <!-- id:WO4CBI3C -->
  - `block` _(required)_: type variable `⟨Block⟩` <!-- id:PobCzv9L -->

**Generic** over `⟨Block⟩` (default [block](../../block.md)). <!-- id:apzRnVg1 -->

# Depends on <!-- id:zX0Jjt30 -->

- [block](../../block.md) <!-- id:F5Wi39wT -->

# See also

- [block](../../block.md): the block this op carries.
- [MoveBlocks](./move-blocks.md): the op that positions a block.
- [SetAttributes](./set-attributes.md): document-level metadata.
- [change/op](../op.md): all operations.
- [Blocks](../../protocol/blocks.md): the block model.
