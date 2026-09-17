---
name: "RPC: Query"
summary: Runs a document query (the same shape a Query block embeds) and returns the matching documents as a query result, or null.
schemaDefinition: ipfs://bafyreihsgf5tz26q6k67sd7cvgpemrrwmpk5relwuc467x2rpj4oprwgy4
---
Runs a document [query](../query.md), the same object a [query block](../protocol/blocks.md) stores. It returns the matching [documents](../protocol/documents.md) as a [query result](./type/query-result.md), or `null`. <!-- id:ikOICZ5G -->

This page describes the **rpc/query** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:ci5mADgR -->

# Shape <!-- id:iirT7bVv -->

A **closed struct** with these fields: <!-- id:BqgxY2nD -->
  - `key` _(required)_: `"Query"` <!-- id:LqFcY9h4 -->
  - `input` _(required)_: [query](../query.md) <!-- id:3CteGWBj -->
  - `output` _(required)_: one of [rpc/type/query-result](./type/query-result.md) | [null](../null.md) <!-- id:e3b637gr -->

# Depends on <!-- id:6QyI0lnv -->

- [query](../query.md) <!-- id:vBboMmrJ -->
- [null](../null.md) <!-- id:BVB9w3KD -->
- [rpc/type/query-result](./type/query-result.md) <!-- id:_MQGXI7B -->

# See also <!-- id:78MA51ot -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:ouf9knxY -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:Kzg0OdGb -->
- [RPC](./method.md): every method in one union. <!-- id:gIl1Ztm1 -->
- [QueryBlock](./query-block.md): the query plus everything a query block renders. <!-- id:9GymTcFl -->
- [Query grammar](../build/query-grammar.md): attribute queries with `QueryDocuments`. <!-- id:kQCXTKjT -->
- [Document Info](./type/document-info.md): one matched document. <!-- id:6xgNIH0j -->
