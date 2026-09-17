---
name: Table Column Block
summary: "One column of a Table block: a childless marker whose id cells reference and whose sibling order is the display order."
schemaDefinition: ipfs://bafyreidojz6dafdqzl644cafmbz6ad3znj76pmkbetsatciedw7inrz7my
---
A column of a [table](./table.md). The block is childless; its id is what cells reference through their `columnId`, and the sibling order of the column blocks is the display order of the columns. Attributes: `width` (pixels), `isHeader` (a header column, honored only on the first column), and the parent-layout pair.

# Shape <!-- id:TfYjxpaq -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:Vc-3f7Au -->
  - `type`: `"TableColumn"` <!-- id:lyKmvrCD -->
  - `attributes`: map { 4 fields } <!-- id:a7O4P0xL -->

# Depends on <!-- id:xtBSktC5 -->

- [block/base](./base.md) <!-- id:54ILX_5f -->
- [block/children-type](./children-type.md) <!-- id:Unn54V5j -->
- [boolean](../boolean.md) <!-- id:jnBF15oW -->
- [float](../float.md) <!-- id:SWXNYg6f -->
