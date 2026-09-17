---
name: Account Result
summary: "The result of resolving an account: its metadata payload, or an explicit not-found."
schemaDefinition: ipfs://bafyreics6pps7x7d75xdcf77lugyahm2zqkg7dqwahzvlxatbtglnag5fq
---
The result of resolving an [account](../../protocol/identity.md): its [metadata payload](./metadata-payload.md), or an explicit not-found. [rpc/account](../account.md) returns it. <!-- id:cQGLYho_ -->

This page describes the **rpc/type/account-result** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:ZMdfA4H5 -->

# Shape <!-- id:GzEze6Bq -->

A **union**. A value matches one of these variants: <!-- id:HZf6WBQs -->
  - map { 4 fields } <!-- id:f267j-6y -->
  - map { 2 fields } <!-- id:RRWidmry -->

# Depends on <!-- id:H_xarqfm -->

- [metadata](../../metadata.md) <!-- id:ht4dyEW_ -->
- [boolean](../../boolean.md) <!-- id:dq0xPHDe -->
- [null](../../null.md) <!-- id:aTp6vL1V -->
- [string](../../string.md) <!-- id:BvamZwgP -->
- [rpc/type/id](./id.md) <!-- id:-A7na0uO -->

# See also <!-- id:uXZhN98c -->

- [Account](../account.md): the method that returns it. <!-- id:47g16n-y -->
- [Metadata Payload](./metadata-payload.md): the found case. <!-- id:ftg-Ij99 -->
- [Identity](../../protocol/identity.md): accounts and keys. <!-- id:hz4vhr7Z -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:wimj_pnE -->
