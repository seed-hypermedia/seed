---
name: Redirect target
summary: A redirect from one document to another space and/or path.
schemaDefinition: ipfs://bafyreigyr2zb7gjachknyt4czzk5c56ctdddlzdush553uk6fw7apa4boi
---
This document describes the **schema/redirect-target** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:BDVJInYn -->

# Shape <!-- id:Mw7vaa0_ -->

A **closed struct** with these fields: <!-- id:vOHPKMNt -->
  - `space` — [principal](../principal.md) <!-- id:BX1XxAo1 -->
  - `path` — [string](./string.md) <!-- id:tkiZCNDO -->
  - `republish` — [boolean](./boolean.md) <!-- id:f8ILSJ4c -->

# Depends on <!-- id:n0grsHmb -->

- [principal](../principal.md) <!-- id:dMEzYQIO -->
- [boolean](./boolean.md) <!-- id:zkw60tb9 -->
- [string](./string.md) <!-- id:jyHqppJd -->
