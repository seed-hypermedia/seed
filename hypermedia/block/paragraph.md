---
name: Paragraph Block
summary: "The default block: a paragraph of text with inline annotations; inside a table row it is a cell and carries the column id."
---
A **paragraph block** is the default block: rich text. It has `text` plus [annotations](./annotation.md) for formatting, links and mentions. Its attributes are the parent-layout pair `childrenType` and `columnCount`, and `columnId`. `columnId` is set only when the paragraph is a cell inside a [table row](./table-row.md), and it names the [table column](./table-column.md) the cell belongs to. <!-- id:AvdJYUyP -->

# See also <!-- id:oIB0zvTp -->

- [block/annotation](./annotation.md): inline formatting, links and mentions. <!-- id:B8OpyRWJ -->
- [block/heading](./heading.md): a section heading. <!-- id:gwQe5owq -->
- [block/table](./table.md): paragraphs as table cells. <!-- id:zZzcEJlI -->
- [Blocks](../protocol/blocks.md): the block model. <!-- id:DpKyw0N2 -->
