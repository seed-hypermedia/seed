---
name: Comment Block
summary: "A block inside a comment body: the open block plus a recursive list of child comment blocks."
schemaDefinition: ipfs://bafyreibth2kanwonruhp2b37xi72lvds5kddpmwlymwrky4ft7fm53o434
---
The body of a [comment](../comment.md) is a list of these: an open [block](../block.md) with its `children` carried inline, rather than the separate [block node](./node.md) wrapper documents use. The block types are the same as in documents; a block comment starts with an [embed](./embed.md) of the quoted block. See [Comments](../protocol/comments.md).

# Shape <!-- id:KpgzcxVT -->

**Extends** [block](../block.md) with these added fields: <!-- id:tCclGqa- -->
  - `children`: list of [block/comment](./comment.md) <!-- id:2Z5R3yQN -->

# Depends on <!-- id:vdGecCjq -->

- [block](../block.md) <!-- id:ijTeP4H8 -->
