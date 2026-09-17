---
name: Heading Block
summary: A section heading whose children are the section; the heading level comes from nesting, not from an attribute.
---
A **heading block** starts a section. It has `text` and [annotations](./annotation.md). There is no level attribute: a heading's depth is its nesting depth. The blocks under it are its section, laid out by `childrenType` and `columnCount` (see [children type](./children-type.md)). In the markdown dialect a heading's children sit at its indentation until the next heading of the same level. <!-- id:TYBBV2Qw -->

# See also <!-- id:SMu2nZ5k -->

- [Blocks](../protocol/blocks.md): nesting and sections. <!-- id:59-B0kCq -->
- [block/node](./node.md): a block and its children. <!-- id:xHXhOGRV -->
- [block/paragraph](./paragraph.md): the default text block. <!-- id:lEMxK_yh -->
- [block/annotation](./annotation.md): inline formatting. <!-- id:30Qa62fP -->
