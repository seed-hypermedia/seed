---
name: Math Block
summary: "A block of LaTeX math, stored as text and rendered with KaTeX."
schemaDefinition: ipfs://bafyreiabl5272ce3ly7c6yc6kiei575vgj3rxhdsnaontxaqh7njju3mhm
---
A math block: `text` is the LaTeX source, rendered with KaTeX. It has no annotations; its only attributes are the parent-layout pair `childrenType` and `columnCount`.

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
