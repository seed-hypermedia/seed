---
name: "RPC: ListChanges"
summary: "Returns a document’s change history as raw change records plus its latest version, given the target id."
schemaDefinition: ipfs://bafyreifv2ymng6qkgqbvwnhg7szptugcxu4ztbvsmtxgevnyogyqi2pelm
---
Lists the history of a [document](../protocol/documents.md) as [raw change records](./type/raw-document-change.md), plus its latest version, given the target id. <!-- id:ihAmEwiL -->

This page describes the **rpc/list-changes** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:TM8oraL9 -->

# Shape <!-- id:i0mfuAmP -->

A **closed struct** with these fields: <!-- id:CpilCY5t -->
  - `key` _(required)_: `"ListChanges"` <!-- id:NrggjHy1 -->
  - `input` _(required)_: map { 1 fields } <!-- id:SM1Ak_h_ -->
  - `output` _(required)_: map { 2 fields } <!-- id:zbAgJ_cH -->

# Depends on <!-- id:xbUuATMI -->

- [string](../string.md) <!-- id:CR9fgC3y -->
- [rpc/type/id](./type/id.md) <!-- id:5kkwJiCD -->
- [rpc/type/raw-document-change](./type/raw-document-change.md) <!-- id:3-1Dl14U -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Documents](../protocol/documents.md): the change DAG, versions and heads.
- [Change](../change.md): the signed change blob.
- [Resource](./resource.md): fetch the document itself.
