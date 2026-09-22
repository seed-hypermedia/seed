---
name: Account Result
summary: "The result of resolving an account: its metadata payload, or an explicit not-found."
---
The result of resolving an [account](../../protocol/identity.md): its [metadata payload](./metadata-payload.md), or an explicit not-found. [rpc/account](../account.md) returns it. <!-- id:cQGLYho_ -->

This page describes the **rpc/type/account-result** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:ZMdfA4H5 -->

# See also <!-- id:uXZhN98c -->

- [Account](../account.md): the method that returns it. <!-- id:47g16n-y -->
- [Metadata Payload](./metadata-payload.md): the found case. <!-- id:ftg-Ij99 -->
- [Identity](../../protocol/identity.md): accounts and keys. <!-- id:hz4vhr7Z -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:wimj_pnE -->
