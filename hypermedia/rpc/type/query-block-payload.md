---
name: Query Block Payload
summary: "Everything a rendered Query block needs: the results plus per-item interaction summaries and author metadata."
---
Everything a rendered [query block](../../protocol/blocks.md) needs: the [results](./document-info.md), per-item [interaction summaries](./query-block-item-summary.md) and author metadata. [rpc/query-block](../query-block.md) returns it. <!-- id:VzSZH5xA -->

This page describes the **rpc/type/query-block-payload** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:OsEQqtxV -->

# See also <!-- id:wm9hJK_g -->

- [QueryBlock](../query-block.md): the method that returns it. <!-- id:XL1_YyB3 -->
- [Query Result](./query-result.md): the results without the extras. <!-- id:ElQjd1_p -->
- [Accounts Metadata](./accounts-metadata.md): the author metadata. <!-- id:SGFlOQQo -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:bJOG3Px4 -->
