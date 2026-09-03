---
name: Video block
summary: A video, referenced by a URL.
schemaDefinition: ipfs://bafyreie6gv75ucgl5c7np6abckxhfur4ivohptz73avdcvaibtor5r3mze
---
This document describes the **hypermedia-block-video** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:EYK9AnN- -->

# Shape <!-- id:P9bV1JXS -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:kf5ps0sg -->
  - `type` — `string` enum: `Video` <!-- id:5rdECHj3 -->
  - `link` _(required)_ — [string](./onyx-string.md) <!-- id:efxgTfxI -->
  - `attributes` — map { 7 fields } <!-- id:B0S2hL6h -->

# Depends on <!-- id:zuMUGUt2 -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:YMbblegu -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:euMK0Tqe -->
- [any](./onyx-any.md) <!-- id:7biHOJn7 -->
- [boolean](./onyx-boolean.md) <!-- id:669ZOxEU -->
- [float](./onyx-float.md) <!-- id:vMQpMpWI -->
- [string](./onyx-string.md) <!-- id:rDzm7GKO -->
