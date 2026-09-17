---
name: Image Block
summary: "An image referenced by an ipfs:// link, with a caption in the text field and an optional display width."
schemaDefinition: ipfs://bafyreici4lod2qvcovhzwubn4rnxjiyfuodq5mnpagqgqts43ifgychmpi
---
An **image block** shows an image. `link` is required and is normally an `ipfs://<cid>` [file](../protocol/files.md) that the daemon serves at `/ipfs/<cid>`. `text` and `annotations` are the caption. Attributes: `width` (display width in pixels), `name` (the original file name), and the parent-layout pair `childrenType` and `columnCount`. Listings also use a document's first image block as a fallback cover.

# Shape <!-- id:cbXa8mno -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:kPTX80QP -->
  - `type`: `"Image"` <!-- id:_SNfeCgs -->
  - `text`: [string](../string.md) <!-- id:DXG_XHw7 -->
  - `annotations`: list of [block/annotation](./annotation.md) <!-- id:Q7w7I2Hz -->
  - `link` _(required)_: [string](../string.md) <!-- id:UYcsuvkH -->
  - `attributes`: map { 4 fields } <!-- id:iqHIaSba -->

# Depends on <!-- id:YPRiA03F -->

- [block/annotation](./annotation.md) <!-- id:MVA73uC9 -->
- [block/base](./base.md) <!-- id:DkHjROke -->
- [block/children-type](./children-type.md) <!-- id:MBr7gZWy -->
- [any](../any.md) <!-- id:Zxb9Dkoq -->
- [float](../float.md) <!-- id:cA9WSlCZ -->
- [string](../string.md) <!-- id:BB8A96g9 -->

# See also

- [Files](../protocol/files.md): how images are stored and served.
- [block/video](./video.md) and [block/file](./file.md): other media blocks.
- [metadata](../metadata.md): `icon` and `cover` images.
- [Blocks](../protocol/blocks.md): the block model.
