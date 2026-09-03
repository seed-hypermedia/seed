---
name: Button block
summary: A labelled button linking somewhere.
schemaDefinition: ipfs://bafyreidmgls5dk5iop5gfe65yxnxo26kqa34rzmvsjnxjusbgd3qglcvoq
---
This document describes the **hypermedia-block-button** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:4MIlhf71 -->

# Shape <!-- id:xGD5dY-c -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:CY2yoTm1 -->
  - `type` — `string` enum: `Button` <!-- id:6Nvnbcfu -->
  - `text` — [string](./onyx-string.md) <!-- id:1F063pXv -->
  - `link` _(required)_ — [string](./onyx-string.md) <!-- id:EESTSjCi -->
  - `attributes` — map { 4 fields } <!-- id:UxIYwOeL -->

# Depends on <!-- id:glOGR_U7 -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:_0hbglqH -->
- [hypermedia-button-alignment](./hypermedia-button-alignment.md) <!-- id:W3GAkILw -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:ViB7NkN7 -->
- [any](./onyx-any.md) <!-- id:kQPzV4Nj -->
- [float](./onyx-float.md) <!-- id:rjjWap8S -->
- [string](./onyx-string.md) <!-- id:dcAn-Ks- -->
