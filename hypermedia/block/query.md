---
name: Query Block
summary: "A block that embeds a live query: the matching documents render in place as cards, a list or a table."
---
A **query block** is a live listing. The author stores a [query](../query.md) in place of a copied list of pages, and every reader sees the current result. Attributes: `query` (required; the spaces and paths to include, the sort and the limit), `style` (a [query style](../query/style.md): `Card`, `List` or `Table`), `columnCount` (card columns, default 3), `banner` (show the first result as a banner), `table` (a [table config](../query/table-config.md) for the table view), and the parent-layout pair. A folder page is usually one query block over its own children. See [Blocks](../protocol/blocks.md) and [the query grammar](../build/query-grammar.md). <!-- id:e-yl1T4D -->

# See also <!-- id:uCskqPDI -->

- [query](../query.md): the query object this block stores. <!-- id:KclDs7Lv -->
- [query/style](../query/style.md) and [query/table-config](../query/table-config.md): how results are shown. <!-- id:yqsyk05c -->
- [Seed API](../build/web-api.md): `QueryBlock` runs a query block. <!-- id:j1Ki_W9h -->
- [Query grammar](../build/query-grammar.md): filtering by attributes. <!-- id:GURAxYKd -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:l_kiOAY_ -->
