---
name: "RPC: Account"
summary: Resolves an account uid to its metadata payload, or to an explicit not-found result.
---
Resolves an [account](../protocol/identity.md) by uid. The result is an [account result](./type/account-result.md): the account's metadata payload, or an explicit not-found. <!-- id:6J7TokxK -->

This page describes the **rpc/account** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:ZU4n5PMC -->

# See also <!-- id:IaPzdtxt -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:XLKRDkIk -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:fpuXk0v9 -->
- [RPC](./method.md): every method in one union. <!-- id:ahIXFmls -->
- [Identity](../protocol/identity.md): accounts, keys and profiles. <!-- id:stMUbZEO -->
- [ListAccounts](./list-accounts.md): every account the daemon knows. <!-- id:LF2hi8rK -->
- [Metadata Payload](./type/metadata-payload.md): the metadata shape. <!-- id:_OmcGg9z -->
