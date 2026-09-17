---
name: Query Inclusion
summary: "One source a query pulls documents from: a space, an optional path prefix inside it, and whether to list direct children or all descendants."
schemaDefinition: ipfs://bafyreiboqg4rghabvpb4mvkbjhalrwkb3hontjm4hebjczrv7vbrroiyne
---
One source of a [query](../query.md): `space` is the account whose documents to list, `path` an optional prefix inside it (a folder), and `mode` either `Children` (the direct children of that path) or `AllDescendants` (everything below it). A directory listing is a query with one inclusion.

# Shape <!-- id:dNz8ygnf -->

A **closed struct** with these fields: <!-- id:6nE0LZik -->
  - `space` _(required)_ — [string](../string.md) <!-- id:_Oh8MBbr -->
  - `path` — [string](../string.md) <!-- id:9WR91zo6 -->
  - `mode` _(required)_ — one of `"Children"` | `"AllDescendants"` <!-- id:7v3c9tNP -->

# Depends on <!-- id:NBioyAez -->

- [string](../string.md) <!-- id:y2iLFCcl -->
