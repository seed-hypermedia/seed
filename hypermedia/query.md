---
name: Query
summary: "A live document query: which spaces and paths to include, how to sort, and an optional limit; the payload of a Query block and of the Query request."
schemaDefinition: ipfs://bafyreiabneylfkr7sja3sydnqury35gndjxyy64bei3bztpr5fb57kjase
---
A **query** is a live document query: which spaces and paths to include, how to sort, and an optional result limit. It is stored in a [query block](./block/query.md)'s attributes, and it is also the input of the Query API. <!-- id:rWL5NDLS -->

`includes` is a list of [inclusions](./query/inclusion.md), each a space, an optional path prefix and a mode of `Children` or `AllDescendants`. `sort` is a list of [sort terms](./query/sort.md), and the daemon applies the first. `limit` caps the result. The same object is the payload of a query block and of the [Seed API](./build/web-api.md)'s [Query](./rpc/query.md) and [QueryBlock](./rpc/query-block.md) requests, which return each matching document's info and metadata. Attribute filters live elsewhere: in the `QueryDocuments` request and the Explore grammar, described in [the query grammar](./build/query-grammar.md).

# Shape <!-- id:lq2339R1 -->

A **closed struct** with these fields: <!-- id:2wTIZ4R0 -->
  - `includes` _(required)_: list of [query/inclusion](./query/inclusion.md) <!-- id:dsd-GXt3 -->
  - `sort`: list of [query/sort](./query/sort.md) <!-- id:OV-3krlD -->
  - `limit`: `integer` <!-- id:oioonYyE -->

# Depends on <!-- id:pvslUZ8E -->

- [query/inclusion](./query/inclusion.md) <!-- id:Yva40J_Y -->
- [query/sort](./query/sort.md) <!-- id:yQzR9VU3 -->

# See also

- [block/query](./block/query.md): the block that renders a query.
- [query/inclusion](./query/inclusion.md) and [query/sort](./query/sort.md): the parts of a query.
- [Query](./rpc/query.md): the API request.
- [Query grammar](./build/query-grammar.md): attribute filters and `QueryDocuments`.
- [Blocks](./protocol/blocks.md): query blocks in documents.
