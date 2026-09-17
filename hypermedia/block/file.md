---
name: File Block
summary: An attachment of any kind, referenced by an ipfs:// link, with its file name and size.
---
A **file block** is an attachment of any kind. `link` is required and is an `ipfs://<cid>` [file](../protocol/files.md). Attributes: `name` (the file name shown to readers), `size` (bytes; older documents stored it as a string, and readers coerce it), and the parent-layout pair `childrenType` and `columnCount`. The block does not store the file's type. The daemon serves the bytes as `application/octet-stream`, and the reader detects the type from the bytes. <!-- id:UrmfOMrW -->

# See also <!-- id:g2HxuAM- -->

- [Files](../protocol/files.md): how files are stored and served. <!-- id:08mkw_F9 -->
- [block/image](./image.md) and [block/video](./video.md): media blocks. <!-- id:Vs1RCs00 -->
- [ipfs-url](../ipfs-url.md): the `ipfs://` reference type. <!-- id:wJBPPRR- -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:7MWyL5HD -->
