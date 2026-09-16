---
name: Table Block
summary: "A table container. Its children are TableColumn blocks (childless; their sibling order defines column display order) followed by TableRow blocks whose children "
schemaDefinition: ipfs://bafyreic67ybhtto7hjzhcr5kabwambbpz3p2tup4c7d62bkwfg6v2wewly
---
A table container. Its children are TableColumn blocks (childless; their sibling order defines column display order) followed by TableRow blocks whose children are Paragraph cells carrying a columnId attribute — cell identity is (row, columnId), never grid position, which is what lets concurrent CRDT edits merge cleanly. <!-- id:62GngDOo -->

This document describes the **block/table** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:H3fdehxc -->

# Shape <!-- id:axji3Nx3 -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:WAdLuZ1t -->
  - `type` — `"Table"` <!-- id:OIXFENDr -->
  - `attributes` — map { 2 fields } <!-- id:1Ug72bRZ -->

# Depends on <!-- id:AgnaGp59 -->

- [block/base](./base.md) <!-- id:fu5elJWe -->
- [block/children-type](./children-type.md) <!-- id:hg7kQizu -->
- [float](../float.md) <!-- id:k8jv_Gf6 -->
