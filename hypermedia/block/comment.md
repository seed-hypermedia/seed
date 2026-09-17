---
name: Comment Block
summary: "A block inside a comment body: the open block plus a recursive list of child comment blocks."
schemaDefinition: ipfs://bafyreibth2kanwonruhp2b37xi72lvds5kddpmwlymwrky4ft7fm53o434
---
A **comment block** is one block of a [comment](../comment.md) body, and the body is a list of them. It is an open [block](../block.md) with its `children` carried inline. Documents use the separate [block node](./node.md) wrapper instead. The block types are the same as in documents. A block comment starts with an [embed](./embed.md) of the quoted block. See [Comments](../protocol/comments.md). <!-- id:3c0g8LgW -->

# Shape <!-- id:KpgzcxVT -->

**Extends** [block](../block.md) with these added fields: <!-- id:tCclGqa- -->
  - `children`: list of [block/comment](./comment.md) <!-- id:2Z5R3yQN -->

# Depends on <!-- id:vdGecCjq -->

- [block](../block.md) <!-- id:ijTeP4H8 -->

# See also <!-- id:NiTxtAJx -->

- [comment](../comment.md): the blob whose body holds these blocks. <!-- id:-JSsqqvv -->
- [Comments](../protocol/comments.md): threads, block comments and citations. <!-- id:Tge4jVOP -->
- [block/node](./node.md): the document form of nested blocks. <!-- id:g0QgsT5H -->
- [block/embed](./embed.md): how a block comment quotes its target. <!-- id:kLZZYUWU -->
