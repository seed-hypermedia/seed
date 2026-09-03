---
name: Image block
summary: An image, referenced by a URL (typically ipfs://).
schemaDefinition: ipfs://bafyreiezaiew4b5r4rex4eaovvzvovibknwrjgnkqwawmicptsqjxcmcam
---
This document describes the **hypermedia-block-image** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:VjEBnK6Y -->

# Shape <!-- id:cbXa8mno -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:kPTX80QP -->
  - `type` — `string` enum: `Image` <!-- id:_SNfeCgs -->
  - `text` — [string](./onyx-string.md) <!-- id:DXG_XHw7 -->
  - `annotations` — list of [hypermedia-annotation](./hypermedia-annotation.md) <!-- id:Q7w7I2Hz -->
  - `link` _(required)_ — [string](./onyx-string.md) <!-- id:UYcsuvkH -->
  - `attributes` — map { 4 fields } <!-- id:iqHIaSba -->

# Depends on <!-- id:YPRiA03F -->

- [hypermedia-annotation](./hypermedia-annotation.md) <!-- id:MVA73uC9 -->
- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:DkHjROke -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:MBr7gZWy -->
- [any](./onyx-any.md) <!-- id:Zxb9Dkoq -->
- [float](./onyx-float.md) <!-- id:cA9WSlCZ -->
- [string](./onyx-string.md) <!-- id:BB8A96g9 -->
