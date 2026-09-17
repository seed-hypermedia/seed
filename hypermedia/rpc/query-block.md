---
name: "RPC: QueryBlock"
summary: Runs a Query block’s query and returns the results plus the per-item interaction summaries and author metadata its rendering needs, or null.
---
Runs the query of a [query block](../protocol/blocks.md) and returns everything the block needs to render: the results, per-item interaction summaries and author metadata. The output is a [query block payload](./type/query-block-payload.md), or `null`. <!-- id:9vWOoz-M -->

This page describes the **rpc/query-block** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:0Yk-OOw5 -->

# See also <!-- id:wnEeTkUa -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:558wqium -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:TTcwcX02 -->
- [RPC](./method.md): every method in one union. <!-- id:diZJKZNM -->
- [Blocks](../protocol/blocks.md): the query block. <!-- id:F4QF5gih -->
- [Query](./query.md): run the query alone. <!-- id:kmd3Fr0L -->
- [Query object](../query.md): the query shape. <!-- id:S7Rwc_u9 -->
