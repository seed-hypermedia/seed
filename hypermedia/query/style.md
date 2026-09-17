---
name: Query Style
summary: "How a Query block presents its results: a card grid, a compact list, or a table."
schemaDefinition: ipfs://bafyreigkm5bnmn5webo2daamcgvko46ppha6rrisprx3ddzqnmdiphwyta
---
The **query style** is the `style` of a [query block](../block/query.md): `Card` (a grid of cards, `columnCount` wide), `List` (compact rows), or `Table` (columns per attribute, configured by a [table config](./table-config.md)).

# Shape <!-- id:oLy5zsFB -->

Kind: `string`. One of: `Card`, `List`, `Table`. <!-- id:vpFHkKnX -->

# See also

- [block/query](../block/query.md): the block that uses this value.
- [query/table-config](./table-config.md): settings for the table style.
- [query](../query.md): the query itself.
