---
name: Query Block Item Summary
summary: "The per-result interaction counts a Query block shows on its cards: comments, children, and author uids."
---
The interaction counts a [query block](../../protocol/blocks.md) shows on each result card: comments, children and author uids. It is part of the [query block payload](./query-block-payload.md). <!-- id:jM3Mzlg2 -->

This page describes the **rpc/type/query-block-item-summary** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:juDfbRKD -->

# See also <!-- id:PcN8_ULZ -->

- [Query Block Payload](./query-block-payload.md): the payload that carries it. <!-- id:PljjZMLv -->
- [Interaction Summary](./interaction-summary.md): the full summary for one document. <!-- id:AS0f3oB2 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:38A52IeB -->
