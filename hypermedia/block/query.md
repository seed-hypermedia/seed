---
name: Query Block
summary: "A block that embeds a live query: the matching documents render in place as cards, a list or a table."
schemaDefinition: ipfs://bafyreiaqt22lnsis4rkqlmeemaqjsw43tmxgfg2tpdewlahncjngqaoipq
---
A query block is a live listing: instead of a copied list of pages, the author stores a [query](../query.md) and every reader sees the current result. Attributes: `query` (required; the spaces and paths to include, the sort and the limit), `style` (a [query style](../query/style.md): `Card`, `List` or `Table`), `columnCount` (card columns, default 3), `banner` (show the first result as a banner), `table` (a [table config](../query/table-config.md) for the table view), and the parent-layout pair. A folder page is usually one query block over its own children. See [Blocks](../protocol/blocks.md) and [the query grammar](../build/query-grammar.md).

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
