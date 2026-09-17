---
name: "RPC: ListChanges"
summary: Returns a document’s change history as raw change records plus its latest version, given the target id.
---
Lists the history of a [document](../protocol/documents.md) as [raw change records](./type/raw-document-change.md), plus its latest version, given the target id. <!-- id:ihAmEwiL -->

This page describes the **rpc/list-changes** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:TM8oraL9 -->

# See also <!-- id:CmEB6W8H -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:weqDXgew -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:pGS2HvxW -->
- [RPC](./method.md): every method in one union. <!-- id:Czr0J415 -->
- [Documents](../protocol/documents.md): the change DAG, versions and heads. <!-- id:daUcL2vp -->
- [Change](../change.md): the signed change blob. <!-- id:w5Pu7ox- -->
- [Resource](./resource.md): fetch the document itself. <!-- id:jEEQdMwU -->
