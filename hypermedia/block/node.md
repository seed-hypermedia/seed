---
name: Block Node
summary: "One node of a content tree: a block plus its ordered child nodes, recursively, which is how documents and comments nest content."
schemaDefinition: ipfs://bafyreihjxsa7cq35s7p2lr3grfturxzwodgxkwtmniygchhbqgeul76fqm
---
A **block node** is one node of the document content tree: a [block](../block.md) plus its ordered child block nodes. The recursion (children of the same type) expresses any depth of nesting. A leaf omits children. <!-- id:_QEoHThv -->

A [document](../document.md)'s `content` and its detached blocks are lists of these nodes, and so is the resolved view of a [comment](../comment.md) body. The tree is derived. The daemon replays the [MoveBlocks](../change/op/move-blocks.md) and [ReplaceBlock](../change/op/replace-block.md) operations of a document's [Changes](../change.md) to place each block under its parent. The parent's `childrenType` attribute decides whether the children read as a plain group, a list, a quote or a grid; see [children type](./children-type.md) and [Blocks](../protocol/blocks.md).

# Shape <!-- id:RgXO3NxT -->

A **closed struct** with these fields: <!-- id:LM850y9F -->
  - `block` _(required)_: [block](../block.md) <!-- id:SwY5yaNk -->
  - `children`: list of [block/node](./node.md) <!-- id:5Kul9cSX -->

# Depends on <!-- id:sFTXQt8U -->

- [block](../block.md) <!-- id:36MLJaY3 -->

# See also

- [Blocks](../protocol/blocks.md): the block tree.
- [document](../document.md): the read model whose `content` is a list of nodes.
- [block/children-type](./children-type.md): how children are laid out.
- [MoveBlocks](../change/op/move-blocks.md): the op that builds the tree.
- [block/comment](./comment.md): the comment form of nested blocks.
