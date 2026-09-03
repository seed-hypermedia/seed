---
name: Query block
summary: "A block that embeds a live query: its results (documents from the queried spaces) render in place, styled as cards, a list, or a table."
schemaDefinition: ipfs://bafyreicv44l6akrlzyob5unjt7cgftvnxldulawzyyzrr73e7pega3o4uu
---
This document describes the **hypermedia-block-query** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:F-SfTMKY -->

# Shape <!-- id:qSgsFftP -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:7mILC7mx -->
  - `type` — `string` enum: `Query` <!-- id:3yDTq8Co -->
  - `attributes` _(required)_ — map { 6 fields } <!-- id:gtQYKj6o -->

# Depends on <!-- id:-mG573Pu -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:KAljEfFl -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:wzJRoaRn -->
- [hypermedia-query](./hypermedia-query.md) <!-- id:6wLgfWnV -->
- [hypermedia-query-style](./hypermedia-query-style.md) <!-- id:QGHoUdMD -->
- [hypermedia-query-table-config](./hypermedia-query-table-config.md) <!-- id:erA6yksW -->
- [boolean](./onyx-boolean.md) <!-- id:WWZ66KvH -->
- [float](./onyx-float.md) <!-- id:e0CF_ISb -->
