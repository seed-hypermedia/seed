---
name: Image Block
summary: An image, referenced by a URL (typically ipfs://).
schemaDefinition: ipfs://bafyreic3gtlw545fyda3ulismghtbrobtdr36pgxfievcrfiq3so4x3a3y
---
This document describes the **block/image** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:VjEBnK6Y -->

# Shape <!-- id:cbXa8mno -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:kPTX80QP -->
  - `type` — `"Image"` <!-- id:_SNfeCgs -->
  - `text` — [string](../string.md) <!-- id:DXG_XHw7 -->
  - `annotations` — list of [block/annotation](./annotation.md) <!-- id:Q7w7I2Hz -->
  - `link` _(required)_ — [string](../string.md) <!-- id:UYcsuvkH -->
  - `attributes` — map { 4 fields } <!-- id:iqHIaSba -->

# Depends on <!-- id:YPRiA03F -->

- [block/annotation](./annotation.md) <!-- id:MVA73uC9 -->
- [block/base](./base.md) <!-- id:DkHjROke -->
- [block/children-type](./children-type.md) <!-- id:MBr7gZWy -->
- [any](../any.md) <!-- id:Zxb9Dkoq -->
- [float](../float.md) <!-- id:cA9WSlCZ -->
- [string](../string.md) <!-- id:BB8A96g9 -->
