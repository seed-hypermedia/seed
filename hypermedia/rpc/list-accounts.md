---
name: "RPC: ListAccounts"
summary: Returns every account the daemon knows as a list of metadata payloads; it takes no meaningful input.
---
Lists every [account](../protocol/identity.md) the daemon knows, as [metadata payloads](./type/metadata-payload.md). The input carries nothing the method uses. <!-- id:5KM-97Ry -->

This page describes the **rpc/list-accounts** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:DiytFRat -->

# See also <!-- id:WD0X6wSG -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:vnliNlOr -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:C79o6SWd -->
- [RPC](./method.md): every method in one union. <!-- id:9ZHRrYRT -->
- [Identity](../protocol/identity.md): accounts and keys. <!-- id:-XIa3jKJ -->
- [Account](./account.md): resolve one account. <!-- id:2dutOrRR -->
