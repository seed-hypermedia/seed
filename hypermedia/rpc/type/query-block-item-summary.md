---
name: Query Block Item Summary
summary: "The per-result interaction counts a Query block shows on its cards: comments, children, and author uids."
schemaDefinition: ipfs://bafyreigigemfx4p4zghramjoxwdxk7wnio6dokcqio2ywu2m6wcqpded6a
---
This page describes the **rpc/type/query-block-item-summary** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:juDfbRKD -->

# Shape <!-- id:_dcwCAEa -->

A **closed struct** with these fields: <!-- id:qq18fyuR -->
  - `comments` _(required)_: `integer` <!-- id:npWZl1gz -->
  - `children`: `integer` <!-- id:3mQ5Cg-9 -->
  - `authorUids`: list of [string](../../string.md) <!-- id:h7HlbaFp -->

# Depends on <!-- id:sjAu9-Sn -->

- [string](../../string.md) <!-- id:5lfnuo9f -->
