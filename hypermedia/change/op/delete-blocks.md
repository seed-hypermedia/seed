---
name: DeleteBlocks Op
summary: The operation that removes blocks from the visible tree by moving them to the trash parent, from which a later move can restore them.
---
**DeleteBlocks** takes [blocks](../../protocol/blocks.md) out of the [document](../../protocol/documents.md). It is a move: it puts each listed block under a special trash parent. So deletion follows the same "latest move wins" rule as any other [move](./move-blocks.md), and a later [Change](../../change.md) can bring the block back. <!-- id:Low_an8O -->

This page defines the **change/op/delete-blocks** operation inside a [Change body](../body.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:O5i7-yOi -->

`blocks` lists the ids to delete. The children of a deleted block go with it, because their parent is not visible any more. The operation does not touch the content of the block. So the history still shows what the block said, and one move restores it. When the [daemon](../../software/daemon.md) prepares a Change for the [Seed app](../../software/desktop.md), it writes one DeleteBlocks, after the moves and before the attribute and content operations. It leaves out blocks that were created and deleted in the same Change. See [Documents](../../protocol/documents.md). <!-- id:R-Sxz-5s -->

# See also <!-- id:WVm97pex -->

- [MoveBlocks](./move-blocks.md): the move rules deletion follows. <!-- id:iHlEhpIT -->
- [ReplaceBlock](./replace-block.md): the content register a delete leaves alone. <!-- id:LQsdUH9V -->
- [change/op](../op.md): all operations. <!-- id:qOu4hWU3 -->
- [Documents](../../protocol/documents.md): replay and history. <!-- id:StvTCa1l -->
