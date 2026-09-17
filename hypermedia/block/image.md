---
name: Image Block
summary: An image referenced by an ipfs:// link, with a caption in the text field and an optional display width.
---
An **image block** shows an image. `link` is required and is normally an `ipfs://<cid>` [file](../protocol/files.md) that the daemon serves at `/ipfs/<cid>`. `text` and `annotations` are the caption. Attributes: `width` (display width in pixels), `name` (the original file name), and the parent-layout pair `childrenType` and `columnCount`. Listings also use a document's first image block as a fallback cover. <!-- id:rnQi1k1d -->

# See also <!-- id:IWMMRALb -->

- [Files](../protocol/files.md): how images are stored and served. <!-- id:PasYGgPu -->
- [block/video](./video.md) and [block/file](./file.md): other media blocks. <!-- id:tSY7meo0 -->
- [metadata](../metadata.md): `icon` and `cover` images. <!-- id:HciBME6z -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:L2ABWG6b -->
