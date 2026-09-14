---
name: Embed Block
summary: An embed of another Hypermedia document (an hm:// URL).
schemaDefinition: ipfs://bafyreih6xh4kifbsuyourwb6lybe33iatkh2ty7mz76ikvdzfafyefna3y
---
This document describes the **schema/block/embed** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qn5BFYI8 -->

# Shape <!-- id:9EPhCUJT -->

**Extends** [schema/block/base](./base.md) with these added fields: <!-- id:2GRM9nIh -->
  - `type` — `"Embed"` <!-- id:b2zVVm3u -->
  - `link` _(required)_ — [string](../string.md) <!-- id:ZiIxjP4h -->
  - `attributes` — map { 3 fields } <!-- id:WnM5P0qp -->

# Depends on <!-- id:MWtO8JbA -->

- [schema/block/base](./base.md) <!-- id:2Avgtd9- -->
- [schema/block/children-type](./children-type.md) <!-- id:oXOIFz_v -->
- [schema/block/embed-view](./embed-view.md) <!-- id:X-BCjyL7 -->
- [any](../any.md) <!-- id:hINcbD3U -->
- [float](../float.md) <!-- id:tf1LXPAe -->
- [string](../string.md) <!-- id:dAdcfEkv -->
