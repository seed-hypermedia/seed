---
name: Table Block
summary: "The container of a table: its children are TableColumn markers followed by TableRow blocks whose Paragraph cells carry a columnId."
---
A **table block** is the container of a table. Its children are TableColumn blocks, which are childless and whose sibling order defines column display order, followed by TableRow blocks whose children are Paragraph cells carrying a columnId attribute. A cell's identity is (row, columnId), never its grid position. That lets concurrent [CRDT](../protocol/documents.md) edits merge cleanly. <!-- id:62GngDOo -->

There is no cell block type. A cell is an ordinary [paragraph](./paragraph.md) under a [table row](./table-row.md) whose `columnId` names a [table column](./table-column.md) id. The order of cells inside a row is ignored. Editing a cell is a text edit on one block. Inserting, reordering or deleting a column is one sibling operation on one column block, and no cell renumbers. Two people who concurrently add a row and reorder the columns merge cleanly. Readers drop cells whose column is gone, render missing cells empty, honor `isHeader` only on the first row and the first column, and ignore rows or columns outside a Table. These are client conventions: the daemon enforces none of them. <!-- id:ygTkeFRQ -->

The Table block's own attributes are only the parent-layout pair. In the markdown dialect a table is a GFM table with a `<!-- id:… -->` line before it, a `<!-- col:… -->` comment in each header cell and a row id comment in each row's last cell. Cell ids are re-derived from (row, column) on update. [Blocks](../protocol/blocks.md) has the worked example and the reasoning. <!-- id:R53P9MRO -->

# See also <!-- id:TsgOyNBa -->

- [block/table-row](./table-row.md): a row of cells. <!-- id:8VI4u7Xh -->
- [block/table-column](./table-column.md): a column marker. <!-- id:8rub-4oQ -->
- [block/paragraph](./paragraph.md): the cell block. <!-- id:xYc1JIas -->
- [Blocks](../protocol/blocks.md): the worked table example. <!-- id:miKhcxV_ -->
- [Documents](../protocol/documents.md): how concurrent edits merge. <!-- id:KeYcOseD -->
