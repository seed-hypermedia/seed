---
name: Query Table Config
summary: "The persisted settings of a Query block's table view: which columns are visible and how wide they are."
schemaDefinition: ipfs://bafyreicgsh5jy23fplg662gpijjhjjdmhnvckaeexfryz7egm3m77dvyv4
---
Presentation settings for the table view of a [query block](../block/query.md): `columns` is a list of `{id, visible, width?}`, where `id` names a built-in column (title, updated, authors and the like) or a custom attribute. Older documents may carry a `sorting` list from before sort moved into the query's own `sort`; readers ignore it.

# Shape <!-- id:d84aVZ53 -->

A **closed struct** with these fields: <!-- id:qLiRI5k4 -->
  - `columns` _(required)_: list of map { 3 fields } <!-- id:K_mebOSM -->

# Depends on <!-- id:DxO1nCj8 -->

- [boolean](../boolean.md) <!-- id:Wq6ojngJ -->
- [string](../string.md) <!-- id:MnlSsHHu -->
