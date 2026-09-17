---
name: MoveBlocks Op
summary: The operation that places a contiguous run of blocks under a parent after a reference position, using RGA op ids so concurrent moves converge and the latest move of a block wins.
schemaDefinition: ipfs://bafyreihivwjksbvqtfh6hzosjx5qsvbujjcnp7lzzooy7vkxdrrxp4dyae
---
**MoveBlocks** gives [blocks](../../protocol/blocks.md) their place in the tree. A [Change](../../change.md) that creates a paragraph uses [ReplaceBlock](./replace-block.md) for its content and MoveBlocks to say where it goes. A Change that reorders a list or indents a block uses MoveBlocks alone. <!-- id:z1F84vi3 -->

This page defines the **change/op/move-blocks** operation inside a [Change body](../body.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:niF7ZUUC -->

`parent` is the id of the block the run goes under; empty means the document root. `blocks` is a contiguous run of sibling ids in order. `ref` is the position to insert after. Empty means the start of the parent's list. `[ts, idx, actor]` names the op that placed the block to the left. A single `[idx]` names an earlier op of this same Change, which is how one op points at a position another op in the same Change created. Inside one op, each block after the first is placed after the block before it, with no `ref` of its own. Each parent's children form a replicated growable array (RGA): concurrent inserts at the same `ref` are ordered by op id with the newer op nearer the ref, so every node ends with the same order. When a block has several moves in its history the latest by op id wins and earlier positions become invisible. A move that would make a block its own ancestor is ignored. Inside one op the counter advances by the element index (the second block gets `idx + 1`, the third `idx + 2` more, and so on), a quirk that is now part of the wire format. See [Documents](../../protocol/documents.md). <!-- id:LUsfvbJw -->

# Shape <!-- id:IA76HbOX -->

A **closed struct** with these fields: <!-- id:dhIYxPj9 -->
  - `type` _(required)_: `"MoveBlocks"` <!-- id:NTqXHSfq -->
  - `parent`: [string](../../string.md) <!-- id:6ypREaYl -->
  - `blocks` _(required)_: list of [string](../../string.md) <!-- id:-kAVnOCA -->
  - `ref`: list of [integer](../../integer.md) <!-- id:Iz-XiAnh -->

# Depends on <!-- id:9VGfsEKn -->

- [string](../../string.md) <!-- id:AmT0qRL2 -->

# See also <!-- id:f0b-WTsl -->

- [ReplaceBlock](./replace-block.md): the op that sets a block's content. <!-- id:4eJG0ZHP -->
- [DeleteBlocks](./delete-blocks.md): a move to the trash. <!-- id:yuzXa8oH -->
- [block/node](../../block/node.md): the tree these moves build. <!-- id:IaY7qzoB -->
- [change/op](../op.md): all operations and op ids. <!-- id:PyNtbOPv -->
- [Documents](../../protocol/documents.md): the CRDT rules. <!-- id:UDTuiF9s -->
