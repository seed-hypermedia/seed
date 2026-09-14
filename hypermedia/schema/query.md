---
name: Query
summary: "A live document query: which spaces/paths to include, how to sort, and an optional result limit. Embedded in a Query block's attributes; also the input of the Q"
schemaDefinition: ipfs://bafyreiemvd6nvcdu4cnivxyghxnw3lolilq64pcnfvnbuwmnhezfbdnqbu
---
A live document query: which spaces/paths to include, how to sort, and an optional result limit. Embedded in a Query block's attributes; also the input of the Query API. <!-- id:rWL5NDLS -->

This document describes the **schema/query** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Rj8kS1xf -->

# Shape <!-- id:lq2339R1 -->

A **closed struct** with these fields: <!-- id:2wTIZ4R0 -->
  - `includes` _(required)_ — list of [schema/query/inclusion](./query/inclusion.md) <!-- id:dsd-GXt3 -->
  - `sort` — list of [schema/query/sort](./query/sort.md) <!-- id:OV-3krlD -->
  - `limit` — `integer` <!-- id:oioonYyE -->

# Depends on <!-- id:pvslUZ8E -->

- [schema/query/inclusion](./query/inclusion.md) <!-- id:Yva40J_Y -->
- [schema/query/sort](./query/sort.md) <!-- id:yQzR9VU3 -->
