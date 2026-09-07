---
name: Video block
summary: A video, referenced by a URL.
schemaDefinition: ipfs://bafyreiholdnnlcsazgiw4zcesre3bc5s2tby27myac7qfw6shbayfd4jxy
---
This document describes the **hypermedia-block-video** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:EYK9AnN- -->

# Shape <!-- id:P9bV1JXS -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:kf5ps0sg -->
  - `type` — `string` enum: `Video` <!-- id:5rdECHj3 -->
  - `link` _(required)_ — [string](./hypermedia-string.md) <!-- id:efxgTfxI -->
  - `attributes` — map { 7 fields } <!-- id:B0S2hL6h -->

# Depends on <!-- id:zuMUGUt2 -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:YMbblegu -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:euMK0Tqe -->
- [any](./hypermedia-any.md) <!-- id:7biHOJn7 -->
- [boolean](./hypermedia-boolean.md) <!-- id:669ZOxEU -->
- [float](./hypermedia-float.md) <!-- id:vMQpMpWI -->
- [string](./hypermedia-string.md) <!-- id:rDzm7GKO -->
