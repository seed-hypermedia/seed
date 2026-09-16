---
name: Video Block
summary: A video, referenced by a URL.
schemaDefinition: ipfs://bafyreicncsk4bhw33ishol33dgaqjoijdyo3k4k2k5hgwwbq3uzik6uhiu
---
This document describes the **block/video** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:EYK9AnN- -->

# Shape <!-- id:P9bV1JXS -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:kf5ps0sg -->
  - `type` — `"Video"` <!-- id:5rdECHj3 -->
  - `link` _(required)_ — [string](../string.md) <!-- id:efxgTfxI -->
  - `attributes` — map { 7 fields } <!-- id:B0S2hL6h -->

# Depends on <!-- id:zuMUGUt2 -->

- [block/base](./base.md) <!-- id:YMbblegu -->
- [block/children-type](./children-type.md) <!-- id:euMK0Tqe -->
- [any](../any.md) <!-- id:7biHOJn7 -->
- [boolean](../boolean.md) <!-- id:669ZOxEU -->
- [float](../float.md) <!-- id:vMQpMpWI -->
- [string](../string.md) <!-- id:rDzm7GKO -->
