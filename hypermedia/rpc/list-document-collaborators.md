---
name: "RPC: ListDocumentCollaborators"
summary: Returns a document’s collaboration picture (publisher, inherited and direct capabilities, effective members), given its id.
---
Resolves who can work on a [document](../protocol/documents.md): the publisher, inherited and direct [capabilities](../protocol/permissions.md), and the effective members. The result is a [collaborators payload](./type/collaborators-payload.md). <!-- id:SpxLa0Jx -->

This page describes the **rpc/list-document-collaborators** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:av_BQwYg -->

# See also <!-- id:2cOAE6zH -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:Vqog98qb -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:PXwtFdCx -->
- [RPC](./method.md): every method in one union. <!-- id:btY9vnnz -->
- [Permissions](../protocol/permissions.md): capabilities, roles and membership. <!-- id:jMwI9Gh5 -->
- [ListCapabilities](./list-capabilities.md): the raw capabilities. <!-- id:d0QYJHuW -->
- [Site Member](./type/site-member.md): one member and their role. <!-- id:pd2Uj869 -->
