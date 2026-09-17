---
name: Query Inclusion
summary: "One source a query pulls documents from: a space, an optional path prefix inside it, and whether to list direct children or all descendants."
---
A **query inclusion** is one source of a [query](../query.md). `space` is the [account](../protocol/identity.md) whose documents to list. `path` is an optional prefix inside it (a folder). `mode` is either `Children` (the direct children of that path) or `AllDescendants` (everything below it). A directory listing is a query with one inclusion. <!-- id:anQ1jfUe -->

# See also <!-- id:Hq1KeCaQ -->

- [query](../query.md): the query that holds inclusions. <!-- id:D46kFAFI -->
- [query/sort](./sort.md): how results are ordered. <!-- id:SUfA4c1m -->
- [block/query](../block/query.md): the block that renders a query. <!-- id:Z06j_fOC -->
- [Documents](../protocol/documents.md): paths and directories. <!-- id:4666wtOu -->
