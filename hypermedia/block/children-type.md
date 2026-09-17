---
name: Children Type
summary: "How a block lays out its children: Group (the default), Ordered, Unordered, Blockquote or Grid."
---
The **children type** says how a block lays out its children. In Hypermedia a list belongs to the parent [block](../block.md). A block's `childrenType` attribute sets how its children render: `Group` (plain, the default when the key is absent or null), `Ordered` (a numbered list), `Unordered` (bullets), `Blockquote`, or `Grid` (columns, with the parent's `columnCount`). Document [metadata](../metadata.md) carries the same key for the root-level blocks, and a `Slot` block gives a top-level list a parent when one is needed. See [Blocks](../protocol/blocks.md). <!-- id:U3_Illlr -->

# See also <!-- id:LgAbOgGf -->

- [Blocks](../protocol/blocks.md): nesting and layout. <!-- id:H8ZOyC4W -->
- [block/node](./node.md): a block and its children. <!-- id:BjYbEmgK -->
- [metadata](../metadata.md): `childrenType` for root-level blocks. <!-- id:0_t30fWF -->
- [block/core](./core.md): all built-in block types. <!-- id:i1BHkIwN -->
