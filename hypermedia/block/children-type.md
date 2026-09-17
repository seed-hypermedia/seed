---
name: Children Type
summary: "How a block lays out its children: Group (the default), Ordered, Unordered, Blockquote or Grid."
schemaDefinition: ipfs://bafyreicwrtydbhkkkoun5ynp4a3mzkmy6ma7svg4zgtmqajivqvw33ohoa
---
The **children type** says how a block lays out its children. In Hypermedia a list belongs to the parent [block](../block.md). A block's `childrenType` attribute sets how its children render: `Group` (plain, the default when the key is absent or null), `Ordered` (a numbered list), `Unordered` (bullets), `Blockquote`, or `Grid` (columns, with the parent's `columnCount`). Document [metadata](../metadata.md) carries the same key for the root-level blocks, and a `Slot` block gives a top-level list a parent when one is needed. See [Blocks](../protocol/blocks.md).

# Shape <!-- id:QSISM9Z4 -->

Kind: `string`. One of: `Group`, `Ordered`, `Unordered`, `Blockquote`, `Grid`. <!-- id:oU57C1U2 -->

# See also

- [Blocks](../protocol/blocks.md): nesting and layout.
- [block/node](./node.md): a block and its children.
- [metadata](../metadata.md): `childrenType` for root-level blocks.
- [block/core](./core.md): all built-in block types.
