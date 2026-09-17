---
name: File Block
summary: An attachment of any kind, referenced by an ipfs:// link, with its file name and size.
schemaDefinition: ipfs://bafyreicb4mgprxbxjdu7x37w5o6vjdlinmtayrep5j6fmdipp3x7vqvqzy
---
A **file block** is an attachment of any kind. `link` is required and is an `ipfs://<cid>` [file](../protocol/files.md). Attributes: `name` (the file name shown to readers), `size` (bytes; older documents stored it as a string, and readers coerce it), and the parent-layout pair `childrenType` and `columnCount`. The block does not store the file's type. The daemon serves the bytes as `application/octet-stream`, and the reader detects the type from the bytes. <!-- id:UrmfOMrW -->

# Shape <!-- id:LvbrriHo -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:SuWQgFEy -->
  - `type`: `"File"` <!-- id:F3pQOCmC -->
  - `link` _(required)_: [string](../string.md) <!-- id:64jUo2lD -->
  - `attributes`: map { 4 fields } <!-- id:0Ah1D5v4 -->

# Depends on <!-- id:nEr--yZq -->

- [block/base](./base.md) <!-- id:3JyMNiV0 -->
- [block/children-type](./children-type.md) <!-- id:twboh5V7 -->
- [any](../any.md) <!-- id:SbzddHuS -->
- [float](../float.md) <!-- id:LO7gu58X -->
- [string](../string.md) <!-- id:b8oDszzV -->

# See also <!-- id:g2HxuAM- -->

- [Files](../protocol/files.md): how files are stored and served. <!-- id:08mkw_F9 -->
- [block/image](./image.md) and [block/video](./video.md): media blocks. <!-- id:Vs1RCs00 -->
- [ipfs-url](../ipfs-url.md): the `ipfs://` reference type. <!-- id:wJBPPRR- -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:7MWyL5HD -->
