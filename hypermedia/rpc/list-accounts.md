---
name: "RPC: ListAccounts"
summary: "Returns every account the daemon knows as a list of metadata payloads; it takes no meaningful input."
schemaDefinition: ipfs://bafyreiczbl22fu5bjxblx5zacwi7fyoij35st5kwjlimhswfx4zqaf3irm
---
Lists every [account](../protocol/identity.md) the daemon knows, as [metadata payloads](./type/metadata-payload.md). The input carries nothing the method uses. <!-- id:5KM-97Ry -->

This page describes the **rpc/list-accounts** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:DiytFRat -->

# Shape <!-- id:1w2fkBth -->

A **closed struct** with these fields: <!-- id:HtDCnuN6 -->
  - `key` _(required)_: `"ListAccounts"` <!-- id:nrPBInN4 -->
  - `input` _(required)_: one of map | [null](../null.md) <!-- id:rapKkCzO -->
  - `output` _(required)_: map { 1 fields } <!-- id:0hkz1VKc -->

# Depends on <!-- id:bHnYGVgD -->

- [null](../null.md) <!-- id:QJ8U0HIB -->
- [rpc/type/metadata-payload](./type/metadata-payload.md) <!-- id:_CB4100E -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Identity](../protocol/identity.md): accounts and keys.
- [Account](./account.md): resolve one account.
