---
name: Table Row Block
summary: "One row of a Table block: its children are Paragraph cells, each naming its column with a columnId attribute."
schemaDefinition: ipfs://bafyreiabl53reqzfvdhyio2vbhocupxb3kzhgakd7p7ji53pgyxpc4gwpa
---
A **table row block** is one row of a [table](./table.md). Its children are the row's cells: [paragraph](./paragraph.md) blocks whose `columnId` attribute names a [table column](./table-column.md) id. Cell order inside the row is ignored. `isHeader` marks the header row and is honored only on the first row. The other attributes are the parent-layout pair.

# Shape <!-- id:rU9d2YT4 -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:YSpWVasd -->
  - `type`: `"TableRow"` <!-- id:35dzjlct -->
  - `attributes`: map { 3 fields } <!-- id:isb0u9Q- -->

# Depends on <!-- id:bJfnmYvm -->

- [block/base](./base.md) <!-- id:hgpcc-H3 -->
- [block/children-type](./children-type.md) <!-- id:wlSrjJ0K -->
- [boolean](../boolean.md) <!-- id:x3gfdVig -->
- [float](../float.md) <!-- id:XcI_JSRk -->

# See also

- [block/table](./table.md): the table container and its rules.
- [block/table-column](./table-column.md): the columns cells point at.
- [block/paragraph](./paragraph.md): the cell block.
- [Blocks](../protocol/blocks.md): the worked table example.
