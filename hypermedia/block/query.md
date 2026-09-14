---
name: Query Block
summary: "A block that embeds a live query: its results (documents from the queried spaces) render in place, styled as cards, a list, or a table."
schemaDefinition: ipfs://bafyreiaucauu6guw7c3wbgti2mpdzyh2pyaabdxx5zkrlfoiz4mti7zzsi
---
This document describes the **block/query** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:F-SfTMKY -->

# Shape <!-- id:qSgsFftP -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:7mILC7mx -->
  - `type` — `"Query"` <!-- id:3yDTq8Co -->
  - `attributes` _(required)_ — map { 6 fields } <!-- id:gtQYKj6o -->

# Depends on <!-- id:-mG573Pu -->

- [block/base](./base.md) <!-- id:KAljEfFl -->
- [block/children-type](./children-type.md) <!-- id:wzJRoaRn -->
- [query](../query.md) <!-- id:6wLgfWnV -->
- [query/style](../query/style.md) <!-- id:QGHoUdMD -->
- [query/table-config](../query/table-config.md) <!-- id:erA6yksW -->
- [boolean](../boolean.md) <!-- id:WWZ66KvH -->
- [float](../float.md) <!-- id:e0CF_ISb -->
