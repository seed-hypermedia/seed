---
name: Code Block
summary: A block of verbatim text, optionally tagged with a programming language for highlighting.
schemaDefinition: ipfs://bafyreih6wdyfie74qafkzhl5ce6g2iagt52lwd22whfn7yuaaen4o3pn2e
---
A **code block** holds verbatim text. `text` is kept exactly as written and has no annotations. `language` names the language for syntax highlighting. `childrenType` and `columnCount` are the usual parent-layout attributes, see [children type](./children-type.md). <!-- id:l1QrJZEk -->

# Shape <!-- id:Wlv2TURN -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:M3xZk6r7 -->
  - `type`: `"Code"` <!-- id:F_X9vLc- -->
  - `text`: [string](../string.md) <!-- id:1CNgUNEp -->
  - `attributes`: map { 3 fields } <!-- id:IzYor5cE -->

# Depends on <!-- id:1PZKCBGr -->

- [block/base](./base.md) <!-- id:UPJREQHL -->
- [block/children-type](./children-type.md) <!-- id:lrSmJj0P -->
- [any](../any.md) <!-- id:FPY-Yu6f -->
- [float](../float.md) <!-- id:dPDYHZ7F -->
- [string](../string.md) <!-- id:ui04XeY6 -->

# See also <!-- id:m2Ul1x7I -->

- [block/math](./math.md): another verbatim-text block. <!-- id:VrcWuP9B -->
- [block/paragraph](./paragraph.md): rich text with annotations. <!-- id:ycDiwY10 -->
- [block/core](./core.md): all built-in block types. <!-- id:XkhMFIb- -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:Yt2lJHe1 -->
