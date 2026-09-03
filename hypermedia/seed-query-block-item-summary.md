---
name: Query block item summary
summary: Per-result interaction counts a Query block shows on its cards. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreihsgfkek2lmuaivtf3jgjzsh536k5csrtxrivtidmf32ogg46ubpe
---
This document describes the **seed-query-block-item-summary** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:juDfbRKD -->

# Shape <!-- id:_dcwCAEa -->

A **closed struct** with these fields: <!-- id:qq18fyuR -->
  - `comments` _(required)_ — `integer` <!-- id:npWZl1gz -->
  - `children` — `integer` <!-- id:3mQ5Cg-9 -->
  - `authorUids` — list of [string](./onyx-string.md) <!-- id:h7HlbaFp -->

# Depends on <!-- id:sjAu9-Sn -->

- [string](./onyx-string.md) <!-- id:5lfnuo9f -->
