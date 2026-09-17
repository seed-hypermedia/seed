---
name: "RPC: Account"
summary: Resolves an account uid to its metadata payload, or to an explicit not-found result.
schemaDefinition: ipfs://bafyreia7idjrnvfoy2fy676lzxjlza46egtlkozyeabr6c62detwkml5hq
---
Resolves an [account](../protocol/identity.md) by uid. The result is an [account result](./type/account-result.md): the account's metadata payload, or an explicit not-found. <!-- id:6J7TokxK -->

This page describes the **rpc/account** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:ZU4n5PMC -->

# Shape <!-- id:59ehBck9 -->

A **closed struct** with these fields: <!-- id:GaSmj_z8 -->
  - `key` _(required)_: `"Account"` <!-- id:XtkZdN5R -->
  - `input` _(required)_: [string](../string.md) <!-- id:Hts3kMP5 -->
  - `output` _(required)_: [rpc/type/account-result](./type/account-result.md) <!-- id:mi5qviZs -->

# Depends on <!-- id:fl4WJGvJ -->

- [string](../string.md) <!-- id:EgZGPF7j -->
- [rpc/type/account-result](./type/account-result.md) <!-- id:ilaQtTDw -->

# See also <!-- id:IaPzdtxt -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:XLKRDkIk -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:fpuXk0v9 -->
- [RPC](./method.md): every method in one union. <!-- id:ahIXFmls -->
- [Identity](../protocol/identity.md): accounts, keys and profiles. <!-- id:stMUbZEO -->
- [ListAccounts](./list-accounts.md): every account the daemon knows. <!-- id:LF2hi8rK -->
- [Metadata Payload](./type/metadata-payload.md): the metadata shape. <!-- id:_OmcGg9z -->
