---
name: Markdown Tables
summary: The markdown table dialect carries table, column and row identities in comments, so a table keeps its history and anchored comments when it is edited through markdown.
---
[Tables](../block/table.md) round-trip through markdown as GFM tables carrying identity comments. The shared dialect is in `frontend/packages/client/src/markdown-to-blocks.ts` and `blocks-to-markdown.ts`. <!-- id:-ULSX1WW -->

An agent meets this dialect when it [reads](./read.md) a document as markdown and when it [writes](./write.md) an update. Keeping the identity comments in place is what lets an edit change a table without replacing it.

# The identity comments

- A standalone `<!-- id:… -->` line before the table is the Table block. <!-- id:mo2H9Hyg -->
- `<!-- col:… -->` inside each header cell is the TableColumn identity. Column order and reorders follow these. <!-- id:j1OVADRs -->
- `<!-- id:… -->` inside each row's last cell is the TableRow identity. It sits in the cell so every line keeps the delimiter row's cell count, because strict GFM refuses tables whose header cell count disagrees. The parser also accepts the comment after the final pipe. <!-- id:DXu3roB3 -->

# What an update preserves

- Cell block ids never appear. On update, `rebindTableIdentities` re-derives each cell as (row id, column id) against the old document, so cell history and anchored comments survive edits. Columns whose comments were dropped still match by header text, then position. <!-- id:8zj3Wck9 -->
- Attributes markdown cannot express (column width, header column) carry over from the old blocks. Plain GFM tables with no comments create fresh tables. <!-- id:GBnQnrR9 -->
- `\|` escapes a pipe, and `<br>` is a newline inside a cell. A headerless HM table emits an all-empty header row and parses back headerless. <!-- id:E6v1ErH- -->

# See also

- [Table block](../block/table.md)
- [Blocks in the protocol](../protocol/blocks.md)
- [Write](./write.md)
- [Read](./read.md)
