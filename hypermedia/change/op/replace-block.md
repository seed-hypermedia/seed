---
name: ReplaceBlock Op
summary: The operation that sets the full state of one block, its id, type, text, link, annotations and attributes, where the newest replacement by op id wins.
---
**ReplaceBlock** is the only way content gets into a [document](../../protocol/documents.md). It carries a whole [block](../../block.md), never a diff. The daemon keeps a register per block id, and the newest ReplaceBlock by op id is the block's state. <!-- id:z4vmPqIg -->

This page defines the **change/op/replace-block** operation inside a [Change body](../body.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:W0uu_eZA -->

`block` is a block map: `id`, `type`, optional `text`, `link` and `annotations`. Any other keys are the block's attributes, inlined at the top level. Older encodings with a nested `attributes` map are still accepted. A block that is replaced but never positioned by [MoveBlocks](./move-blocks.md) is a detached block. It is kept, returned by the API, and rendered by the apps outside the main tree, which is how custom [navigation](../../metadata/navigation-item.md) is stored. The API reports each block's `revision`, the CID of the [Change](../../change.md) whose ReplaceBlock currently defines it. The operation is generic over the block type, so a schema can pin a stricter block model. See [Blocks](../../protocol/blocks.md) for what goes inside a block. <!-- id:ztxKecj4 -->

# See also <!-- id:YMsW0s-F -->

- [block](../../block.md): the block this op carries. <!-- id:m-rezJiC -->
- [MoveBlocks](./move-blocks.md): the op that positions a block. <!-- id:jwiieyrK -->
- [SetAttributes](./set-attributes.md): document-level metadata. <!-- id:4PvUFltK -->
- [change/op](../op.md): all operations. <!-- id:eTceYWQ_ -->
- [Blocks](../../protocol/blocks.md): the block model. <!-- id:sSuS07jS -->
