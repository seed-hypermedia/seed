---
name: Query Table Config
summary: "The persisted settings of a Query block's table view: which columns are visible and how wide they are."
---
The **query table config** holds the settings for the table view of a [query block](../block/query.md). `columns` is a list of `{id, visible, width?}`, where `id` names a built-in column (title, updated, authors and the like) or a custom [attribute](../metadata.md). Older documents may carry a `sorting` list from before sort moved into the query's own `sort`. Readers ignore it. <!-- id:c3_oRvGx -->

# See also <!-- id:30RPirtV -->

- [query/style](./style.md): the `Table` style that uses this config. <!-- id:bDZGTYq3 -->
- [block/query](../block/query.md): the block that holds it. <!-- id:WtfEcAgL -->
- [query/sort](./sort.md): where sorting lives now. <!-- id:yvD3C3tt -->
- [metadata](../metadata.md): the attributes a column can show. <!-- id:Xk9TkCjv -->
