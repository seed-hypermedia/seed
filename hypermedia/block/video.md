---
name: Video Block
summary: A video referenced by an ipfs:// file or a supported web video URL, with playback attributes.
schemaDefinition: ipfs://bafyreicncsk4bhw33ishol33dgaqjoijdyo3k4k2k5hgwwbq3uzik6uhiu
---
A **video block** plays a video. `link` is required: either an `ipfs://<cid>` [file](../protocol/files.md) or a web video URL the app knows how to embed (YouTube links are recognized). Attributes: `width`, `name`, the playback flags `autoplay`, `loop` and `muted`, and the parent-layout pair. <!-- id:PpGZPngz -->

# Shape <!-- id:P9bV1JXS -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:kf5ps0sg -->
  - `type`: `"Video"` <!-- id:5rdECHj3 -->
  - `link` _(required)_: [string](../string.md) <!-- id:efxgTfxI -->
  - `attributes`: map { 7 fields } <!-- id:B0S2hL6h -->

# Depends on <!-- id:zuMUGUt2 -->

- [block/base](./base.md) <!-- id:YMbblegu -->
- [block/children-type](./children-type.md) <!-- id:euMK0Tqe -->
- [any](../any.md) <!-- id:7biHOJn7 -->
- [boolean](../boolean.md) <!-- id:669ZOxEU -->
- [float](../float.md) <!-- id:vMQpMpWI -->
- [string](../string.md) <!-- id:rDzm7GKO -->

# See also <!-- id:Ivf73fmA -->

- [Files](../protocol/files.md): how media files are stored and served. <!-- id:bdnpxpDp -->
- [block/image](./image.md) and [block/file](./file.md): other media blocks. <!-- id:ytBQCEPp -->
- [block/web-embed](./web-embed.md): embeds of web pages and posts. <!-- id:xYs4GBpv -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:c7G_FLOq -->
