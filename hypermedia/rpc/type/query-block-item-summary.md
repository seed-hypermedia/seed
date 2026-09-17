---
name: Query Block Item Summary
summary: "The per-result interaction counts a Query block shows on its cards: comments, children, and author uids."
schemaDefinition: ipfs://bafyreigigemfx4p4zghramjoxwdxk7wnio6dokcqio2ywu2m6wcqpded6a
---
The interaction counts a [query block](../../protocol/blocks.md) shows on each result card: comments, children and author uids. It is part of the [query block payload](./query-block-payload.md).

This page describes the **rpc/type/query-block-item-summary** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:juDfbRKD -->

# Shape <!-- id:_dcwCAEa -->

A **closed struct** with these fields: <!-- id:qq18fyuR -->
  - `comments` _(required)_: `integer` <!-- id:npWZl1gz -->
  - `children`: `integer` <!-- id:3mQ5Cg-9 -->
  - `authorUids`: list of [string](../../string.md) <!-- id:h7HlbaFp -->

# Depends on <!-- id:sjAu9-Sn -->

- [string](../../string.md) <!-- id:5lfnuo9f -->

# See also

- [Query Block Payload](./query-block-payload.md): the payload that carries it.
- [Interaction Summary](./interaction-summary.md): the full summary for one document.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
