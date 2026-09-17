---
name: Block Node
summary: "One node of a content tree: a block plus its ordered child nodes, recursively, which is how documents and comments nest content."
schemaDefinition: ipfs://bafyreihjxsa7cq35s7p2lr3grfturxzwodgxkwtmniygchhbqgeul76fqm
---
A node of the document content tree: a Block plus its ordered child Block nodes. The recursion (children of the same type) expresses arbitrary nesting; a leaf simply omits children. <!-- id:_QEoHThv -->

A [document](../document.md)'s `content` and its detached blocks are lists of these nodes, and so is the resolved view of a comment body. The tree is derived: the daemon replays the [MoveBlocks](../change/op/move-blocks.md) and [ReplaceBlock](../change/op/replace-block.md) operations of a document's Changes to place each block under its parent, and the parent's `childrenType` attribute decides whether the children read as a plain group, a list, a quote or a grid. See [Blocks](../protocol/blocks.md).

# Shape <!-- id:RgXO3NxT -->

A **closed struct** with these fields: <!-- id:LM850y9F -->
  - `block` _(required)_: [block](../block.md) <!-- id:SwY5yaNk -->
  - `children`: list of [block/node](./node.md) <!-- id:5Kul9cSX -->

# Depends on <!-- id:sFTXQt8U -->

- [block](../block.md) <!-- id:36MLJaY3 -->
