---
name: Embed Block
summary: "An embed of another Hypermedia document, block or text range by hm:// link, rendered as content, a card, its comments or a link."
schemaDefinition: ipfs://bafyreieeqpq56yohtcs2irt4k2s3o4jw7vgyxymuuza62s6shygcrzy4p4
---
An embed shows another Hypermedia resource in place. `link` is required and is an `hm://` URL, which may pin a version with `?v=`, follow the latest with `&l`, and narrow the target to a block (`#id`), a block with its children (`#id+`) or a text range (`#id[start:end]`); see [URLs](../protocol/urls.md). The `view` attribute is an [embed view](./embed-view.md): `Content`, `Card`, `Comments` or `Link`. A block comment is a comment whose body starts with an Embed of the quoted block. Renderers detect cycles and fall back to a link.

# Shape <!-- id:9EPhCUJT -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:2GRM9nIh -->
  - `type` — `"Embed"` <!-- id:b2zVVm3u -->
  - `link` _(required)_ — [string](../string.md) <!-- id:ZiIxjP4h -->
  - `attributes` — map { 3 fields } <!-- id:WnM5P0qp -->

# Depends on <!-- id:MWtO8JbA -->

- [block/base](./base.md) <!-- id:2Avgtd9- -->
- [block/children-type](./children-type.md) <!-- id:oXOIFz_v -->
- [block/embed-view](./embed-view.md) <!-- id:X-BCjyL7 -->
- [any](../any.md) <!-- id:hINcbD3U -->
- [float](../float.md) <!-- id:tf1LXPAe -->
- [string](../string.md) <!-- id:dAdcfEkv -->
