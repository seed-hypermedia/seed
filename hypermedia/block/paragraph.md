---
name: Paragraph Block
summary: "The default block: a paragraph of text with inline annotations; inside a table row it is a cell and carries the column id."
schemaDefinition: ipfs://bafyreifjzaopfo4ugenflaf52bmubt25wagkxxqb5miasjb3yazzhbayvu
---
A paragraph of rich text: `text` plus [annotations](./annotation.md) for formatting, links and mentions. Attributes are the parent-layout pair `childrenType` and `columnCount`, and `columnId`, which is set only when the paragraph is a cell inside a [table row](./table-row.md) and names the [table column](./table-column.md) it belongs to.

# Shape <!-- id:l0o5Tte_ -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:a3oACyxn -->
  - `type` — `"Paragraph"` <!-- id:tHz4ynCQ -->
  - `text` — [string](../string.md) <!-- id:_0H0S0T5 -->
  - `annotations` — list of [block/annotation](./annotation.md) <!-- id:pXxDvrgh -->
  - `attributes` — map { 3 fields } <!-- id:ohl09HNZ -->

# Depends on <!-- id:yL-NVw3Z -->

- [block/annotation](./annotation.md) <!-- id:T-dO1QZb -->
- [block/base](./base.md) <!-- id:-NxYvbtm -->
- [block/children-type](./children-type.md) <!-- id:YV6PY--I -->
- [any](../any.md) <!-- id:Kyh6AeJj -->
- [float](../float.md) <!-- id:MOYG_rHe -->
- [string](../string.md) <!-- id:Pf_eLNrP -->
