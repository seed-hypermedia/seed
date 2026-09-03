---
name: Table row block
summary: One row of a Table block. Its children are Paragraph cell blocks, each carrying a columnId attribute referencing a TableColumn id.
schemaDefinition: ipfs://bafyreibezqw7hd5hisnw6djkotkyyixgx4ip5bclcletjxaf7zkqzw3eqa
---
This document describes the **hypermedia-block-table-row** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:BjIgY6_L -->

# Shape <!-- id:rU9d2YT4 -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:YSpWVasd -->
  - `type` — `string` enum: `TableRow` <!-- id:35dzjlct -->
  - `attributes` — map { 3 fields } <!-- id:isb0u9Q- -->

# Depends on <!-- id:bJfnmYvm -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:hgpcc-H3 -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:wlSrjJ0K -->
- [boolean](./onyx-boolean.md) <!-- id:x3gfdVig -->
- [float](./onyx-float.md) <!-- id:XcI_JSRk -->
