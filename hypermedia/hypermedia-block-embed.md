---
name: Embed block
summary: An embed of another Hypermedia document (an hm:// URL).
schemaDefinition: ipfs://bafyreibzirxbmnkzv3tizyimgu4ee4x3scrwbr53vusfkfe3fdjz3jo5fq
---
This document describes the **hypermedia-block-embed** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qn5BFYI8 -->

# Shape <!-- id:9EPhCUJT -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:2GRM9nIh -->
  - `type` — `string` enum: `Embed` <!-- id:b2zVVm3u -->
  - `link` _(required)_ — [string](./onyx-string.md) <!-- id:ZiIxjP4h -->
  - `attributes` — map { 3 fields } <!-- id:WnM5P0qp -->

# Depends on <!-- id:MWtO8JbA -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:2Avgtd9- -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:oXOIFz_v -->
- [hypermedia-embed-view](./hypermedia-embed-view.md) <!-- id:X-BCjyL7 -->
- [any](./onyx-any.md) <!-- id:hINcbD3U -->
- [float](./onyx-float.md) <!-- id:tf1LXPAe -->
- [string](./onyx-string.md) <!-- id:dAdcfEkv -->
