---
name: Table Column Block
summary: "One column of a Table block: a childless marker whose id cells reference and whose sibling order is the display order."
schemaDefinition: ipfs://bafyreidojz6dafdqzl644cafmbz6ad3znj76pmkbetsatciedw7inrz7my
---
A **table column block** is one column of a [table](./table.md). The block is childless. Cells reference its id through their `columnId`, and the sibling order of the column blocks is the display order of the columns. Attributes: `width` (pixels), `isHeader` (a header column, honored only on the first column), and the parent-layout pair. <!-- id:WtQE4hZf -->

# Shape <!-- id:TfYjxpaq -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:Vc-3f7Au -->
  - `type`: `"TableColumn"` <!-- id:lyKmvrCD -->
  - `attributes`: map { 4 fields } <!-- id:a7O4P0xL -->

# Depends on <!-- id:xtBSktC5 -->

- [block/base](./base.md) <!-- id:54ILX_5f -->
- [block/children-type](./children-type.md) <!-- id:Unn54V5j -->
- [boolean](../boolean.md) <!-- id:jnBF15oW -->
- [float](../float.md) <!-- id:SWXNYg6f -->

# See also <!-- id:2Uh9H8pb -->

- [block/table](./table.md): the table container and its rules. <!-- id:nM30eOUk -->
- [block/table-row](./table-row.md): a row of cells. <!-- id:kZgzsniB -->
- [block/paragraph](./paragraph.md): the cell block. <!-- id:7qZrpbDX -->
- [Blocks](../protocol/blocks.md): the worked table example. <!-- id:uRoKIqVD -->
