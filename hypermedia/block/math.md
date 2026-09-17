---
name: Math Block
summary: A block of LaTeX math, stored as text and rendered with KaTeX.
schemaDefinition: ipfs://bafyreiabl5272ce3ly7c6yc6kiei575vgj3rxhdsnaontxaqh7njju3mhm
---
A **math block** holds LaTeX. `text` is the LaTeX source, rendered with KaTeX. It has no annotations. Its only attributes are the parent-layout pair `childrenType` and `columnCount`, see [children type](./children-type.md). <!-- id:LfAX0Aj0 -->

# Shape <!-- id:aWWfkPD5 -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:SBltfmzC -->
  - `type`: `"Math"` <!-- id:svQxxVDN -->
  - `text`: [string](../string.md) <!-- id:Fn40dsDZ -->
  - `attributes`: map { 2 fields } <!-- id:9xuaTSwI -->

# Depends on <!-- id:2UNOf9xM -->

- [block/base](./base.md) <!-- id:LayK8q5D -->
- [block/children-type](./children-type.md) <!-- id:nMsh63jO -->
- [any](../any.md) <!-- id:Pte3s6Aa -->
- [float](../float.md) <!-- id:iP9RpaYy -->
- [string](../string.md) <!-- id:CfYrEM4W -->

# See also <!-- id:_QV0H5-Z -->

- [block/code](./code.md): verbatim code. <!-- id:5d82U7oM -->
- [block/paragraph](./paragraph.md): rich text. <!-- id:G3Oaj962 -->
- [block/core](./core.md): all built-in block types. <!-- id:j3QUcX11 -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:1lsbiM6F -->
