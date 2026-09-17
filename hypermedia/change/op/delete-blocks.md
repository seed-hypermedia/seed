---
name: DeleteBlocks Op
summary: The operation that removes blocks from the visible tree by moving them to the trash parent, from which a later move can restore them.
schemaDefinition: ipfs://bafyreifgmya24hxpzucvnpvmosmer6p6grfzmmqv5uuzo7zmhhozevmlh4
---
DeleteBlocks takes blocks out of the document. Under the hood it is a move: each listed block is placed under a special trash parent, so deletion follows the same "latest move wins" rule as any other move and a later Change can bring the block back. <!-- id:Low_an8O -->

This page defines the **change/op/delete-blocks** operation inside a [Change body](../body.md). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:O5i7-yOi -->

`blocks` lists the ids to delete. Children of a deleted block go with it, because they hang off a parent that is no longer visible. The block's content register is untouched, which is why the history still shows what the block said and why restoring is a single move. When the daemon prepares a Change for the Seed app it emits one DeleteBlocks, after the moves and before the attribute and content ops, and drops blocks that were created and deleted within the same Change. See [Documents](../../protocol/documents.md). <!-- id:R-Sxz-5s -->

# Shape <!-- id:ZBAbxMDE -->

A **closed struct** with these fields: <!-- id:hVjHrQ0n -->
  - `type` _(required)_ — `"DeleteBlocks"` <!-- id:zKHm9p4w -->
  - `blocks` _(required)_ — list of [string](../../string.md) <!-- id:C3LbdbSU -->

# Depends on <!-- id:MskatxS8 -->

- [string](../../string.md) <!-- id:_2S5kV0V -->
