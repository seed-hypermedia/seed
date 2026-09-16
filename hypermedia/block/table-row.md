---
name: Table Row Block
summary: One row of a Table block. Its children are Paragraph cell blocks, each carrying a columnId attribute referencing a TableColumn id.
schemaDefinition: ipfs://bafyreiabl53reqzfvdhyio2vbhocupxb3kzhgakd7p7ji53pgyxpc4gwpa
---
This document describes the **block/table-row** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:BjIgY6_L -->

# Shape <!-- id:rU9d2YT4 -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:YSpWVasd -->
  - `type` — `"TableRow"` <!-- id:35dzjlct -->
  - `attributes` — map { 3 fields } <!-- id:isb0u9Q- -->

# Depends on <!-- id:bJfnmYvm -->

- [block/base](./base.md) <!-- id:hgpcc-H3 -->
- [block/children-type](./children-type.md) <!-- id:wlSrjJ0K -->
- [boolean](../boolean.md) <!-- id:x3gfdVig -->
- [float](../float.md) <!-- id:XcI_JSRk -->
