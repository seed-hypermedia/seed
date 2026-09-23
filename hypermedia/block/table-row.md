---
name: Table Row Block
summary: "One row of a Table block: its children are Paragraph cells, each naming its column with a columnId attribute."
---
A **table row block** is one row of a [table](./table.md). Its children are the row's cells: [paragraph](./paragraph.md) blocks whose `columnId` attribute names a [table column](./table-column.md) id. Cell order inside the row is ignored. `isHeader` marks the header row and is honored only on the first row. The other attributes are the parent-layout pair. <!-- id:x6S93WE8 -->

# See also <!-- id:IQTE-Yrd -->

- [block/table](./table.md): the table container and its rules. <!-- id:iDNVIL7Y -->
- [block/table-column](./table-column.md): the columns cells point at. <!-- id:Gy-Xpmw9 -->
- [block/paragraph](./paragraph.md): the cell block. <!-- id:roNC78Ty -->
- [Blocks](../protocol/blocks.md): the worked table example. <!-- id:ZTr6Ehtt -->
