---
name: Markdown Tables
summary: A table is read and written as a markdown table that carries small identity comments, so the table keeps its history and its comments when an agent edits it.
---
A [table](../block/table.md) in a [document](../protocol/documents.md) is read and written as a normal GFM markdown table, with a few small comments added. The comments say which table, which column and which row each part is. They are what lets an edit change a table and not replace it. <!-- id:-ULSX1WW -->

For example:

```markdown
<!-- id:tbl1AbCd -->
| Name <!-- col:c1XyZ123 --> | Status <!-- col:c2XyZ456 --> |
| --- | --- |
| Alice | Done <!-- id:r1QwErTy --> |
```

An [agent](../agent.md) meets this format when it [reads](./read.md) a document as markdown and when it [writes](./write.md) an update. The rule is simple: keep the comments of everything you keep. The format is shared code, in `frontend/packages/client/src/markdown-to-blocks.ts` and `blocks-to-markdown.ts`.

# The identity comments

- A `<!-- id:… -->` line alone, before the table, is the identity of the Table block. <!-- id:mo2H9Hyg -->
- `<!-- col:… -->` inside each header cell is the identity of the column (TableColumn). The order of columns follows these. <!-- id:j1OVADRs -->
- `<!-- id:… -->` inside the last cell of each row is the identity of the row (TableRow). It sits inside the cell so every line has the same number of cells. Strict GFM refuses a table whose lines have different cell counts. The parser also accepts the comment after the final pipe. <!-- id:DXu3roB3 -->

# What an update preserves

- Cells never show an id. On update, `rebindTableIdentities` finds each cell again by its row id and column id in the old document. So the history of a cell, and [comments](../protocol/comments.md) attached to it, survive an edit. A column that lost its comment still matches by header text, then by position. <!-- id:8zj3Wck9 -->
- Some attributes cannot be written in markdown, such as column width and header column. They carry over from the old blocks. A plain GFM table with no comments creates a new table. <!-- id:GBnQnrR9 -->
- `\|` is a literal pipe, and `<br>` is a line break inside a cell. A table with no header is written with an empty header row, and is read back as a table with no header. <!-- id:E6v1ErH- -->

# See also

- [Table block](../block/table.md)
- [Blocks in the protocol](../protocol/blocks.md)
- [Write](./write.md)
- [Read](./read.md)
