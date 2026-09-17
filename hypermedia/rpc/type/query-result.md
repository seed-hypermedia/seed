---
name: Query Result
summary: The documents a query matched, listed under the queried id together with the mode (children or all descendants) that was used.
---
The [documents](../../protocol/documents.md) a [query](../../query.md) matched, listed under the queried id with the mode it used: children or all descendants. [rpc/query](../query.md) returns it. <!-- id:_y6cBqwD -->

This page describes the **rpc/type/query-result** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:02nM8--s -->

# See also <!-- id:j4TyEy7z -->

- [Query](../query.md): the method that returns it. <!-- id:o04oQ-fo -->
- [Document Info](./document-info.md): each result. <!-- id:Buo3NppS -->
- [Query Block Payload](./query-block-payload.md): the results plus what a query block renders. <!-- id:3S-DEzkS -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:y1A5lcVb -->
