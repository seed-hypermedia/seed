---
name: Query Result
summary: "The documents a query matched, listed under the queried id together with the mode (children or all descendants) that was used."
schemaDefinition: ipfs://bafyreigsuyglngb3yrik7kdvsczwgjheao7ccd6ncwif6zp5kenon2cvka
---
The [documents](../../protocol/documents.md) a [query](../../query.md) matched, listed under the queried id with the mode it used: children or all descendants. [rpc/query](../query.md) returns it.

This page describes the **rpc/type/query-result** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:02nM8--s -->

# Shape <!-- id:IU9zCBCy -->

A **closed struct** with these fields: <!-- id:EvmdoseV -->
  - `in` _(required)_: [rpc/type/id](./id.md) <!-- id:JZ6P9O4y -->
  - `results` _(required)_: list of [rpc/type/document-info](./document-info.md) <!-- id:eo8ia6we -->
  - `mode`: one of `"Children"` | `"AllDescendants"` <!-- id:RePHCtTX -->

# Depends on <!-- id:uRtiQkyh -->

- [rpc/type/document-info](./document-info.md) <!-- id:U3vw88Mz -->
- [rpc/type/id](./id.md) <!-- id:l99ph1Cb -->

# See also

- [Query](../query.md): the method that returns it.
- [Document Info](./document-info.md): each result.
- [Query Block Payload](./query-block-payload.md): the results plus what a query block renders.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
