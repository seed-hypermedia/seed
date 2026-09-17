---
name: Query Table Config
summary: "The persisted settings of a Query block's table view: which columns are visible and how wide they are."
schemaDefinition: ipfs://bafyreicgsh5jy23fplg662gpijjhjjdmhnvckaeexfryz7egm3m77dvyv4
---
The **query table config** holds the settings for the table view of a [query block](../block/query.md). `columns` is a list of `{id, visible, width?}`, where `id` names a built-in column (title, updated, authors and the like) or a custom [attribute](../metadata.md). Older documents may carry a `sorting` list from before sort moved into the query's own `sort`. Readers ignore it.

# Shape <!-- id:d84aVZ53 -->

A **closed struct** with these fields: <!-- id:qLiRI5k4 -->
  - `columns` _(required)_: list of map { 3 fields } <!-- id:K_mebOSM -->

# Depends on <!-- id:DxO1nCj8 -->

- [boolean](../boolean.md) <!-- id:Wq6ojngJ -->
- [string](../string.md) <!-- id:MnlSsHHu -->

# See also

- [query/style](./style.md): the `Table` style that uses this config.
- [block/query](../block/query.md): the block that holds it.
- [query/sort](./sort.md): where sorting lives now.
- [metadata](../metadata.md): the attributes a column can show.
