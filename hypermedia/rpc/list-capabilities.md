---
name: "RPC: ListCapabilities"
summary: Returns the raw capabilities granted on a target document, given its id.
---
Lists the [capabilities](../protocol/permissions.md) granted on a target [document](../protocol/documents.md), given its id. Each one comes back as a [raw capability](./type/raw-capability.md). <!-- id:L8_yo2Q9 -->

This page describes the **rpc/list-capabilities** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:IqUUi73s -->

# See also <!-- id:63fPQAti -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:Lfoo9DmI -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:5nD_J0Hg -->
- [RPC](./method.md): every method in one union. <!-- id:4VIMqENU -->
- [Permissions](../protocol/permissions.md): capabilities, roles and delegation. <!-- id:O2ilWxXM -->
- [Capability](../capability.md): the signed capability blob. <!-- id:FA_XiZyR -->
- [ListDocumentCollaborators](./list-document-collaborators.md): the resolved collaboration picture. <!-- id:YEPxTHBu -->
