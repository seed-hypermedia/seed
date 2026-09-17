---
name: File Block
summary: "An attachment of any kind, referenced by an ipfs:// link, with its file name and size."
schemaDefinition: ipfs://bafyreicb4mgprxbxjdu7x37w5o6vjdlinmtayrep5j6fmdipp3x7vqvqzy
---
A file attachment: `link` is required and is an `ipfs://<cid>` [file](../protocol/files.md). Attributes: `name` (the file name shown to readers), `size` (bytes; older documents stored it as a string, and readers coerce it), and the parent-layout pair. The file's type is detected from its bytes when served, not stored on the block.

# Shape <!-- id:LvbrriHo -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:SuWQgFEy -->
  - `type` — `"File"` <!-- id:F3pQOCmC -->
  - `link` _(required)_ — [string](../string.md) <!-- id:64jUo2lD -->
  - `attributes` — map { 4 fields } <!-- id:0Ah1D5v4 -->

# Depends on <!-- id:nEr--yZq -->

- [block/base](./base.md) <!-- id:3JyMNiV0 -->
- [block/children-type](./children-type.md) <!-- id:twboh5V7 -->
- [any](../any.md) <!-- id:SbzddHuS -->
- [float](../float.md) <!-- id:LO7gu58X -->
- [string](../string.md) <!-- id:b8oDszzV -->
