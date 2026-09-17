---
name: Table Block
summary: "The container of a table: its children are TableColumn markers followed by TableRow blocks whose Paragraph cells carry a columnId."
schemaDefinition: ipfs://bafyreic67ybhtto7hjzhcr5kabwambbpz3p2tup4c7d62bkwfg6v2wewly
---
A table container. Its children are TableColumn blocks (childless; their sibling order defines column display order) followed by TableRow blocks whose children are Paragraph cells carrying a columnId attribute — cell identity is (row, columnId), never grid position, which is what lets concurrent CRDT edits merge cleanly. <!-- id:62GngDOo -->

There is no cell block type. A cell is an ordinary [paragraph](./paragraph.md) under a [table row](./table-row.md) whose `columnId` names a [table column](./table-column.md) id; the order of cells inside a row is ignored. Editing a cell is a text edit on one block; inserting, reordering or deleting a column is one sibling operation on one column block and no cell renumbers; two people who concurrently add a row and reorder the columns merge cleanly. Readers drop cells whose column is gone, render missing cells empty, honor `isHeader` only on the first row and the first column, and ignore rows or columns outside a Table. The daemon enforces none of this, so these are client conventions.

The Table block's own attributes are only the parent-layout pair. In the markdown dialect a table is a GFM table with a `<!-- id:… -->` line before it, a `<!-- col:… -->` comment in each header cell and a row id comment in each row's last cell; cell ids are re-derived from (row, column) on update. The worked example and the reasoning are on [Blocks](../protocol/blocks.md).

# Shape <!-- id:axji3Nx3 -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:WAdLuZ1t -->
  - `type` — `"Table"` <!-- id:OIXFENDr -->
  - `attributes` — map { 2 fields } <!-- id:1Ug72bRZ -->

# Depends on <!-- id:AgnaGp59 -->

- [block/base](./base.md) <!-- id:fu5elJWe -->
- [block/children-type](./children-type.md) <!-- id:hg7kQizu -->
- [float](../float.md) <!-- id:k8jv_Gf6 -->
