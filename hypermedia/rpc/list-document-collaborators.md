---
name: "RPC: ListDocumentCollaborators"
summary: "Returns a document’s collaboration picture (publisher, inherited and direct capabilities, effective members), given its id."
schemaDefinition: ipfs://bafyreie3rvsn6kwc7qzawxklw2wp5q63dnt27fwpymywpl3paaruyxlenu
---
Resolves who can work on a [document](../protocol/documents.md): the publisher, inherited and direct [capabilities](../protocol/permissions.md), and the effective members. The result is a [collaborators payload](./type/collaborators-payload.md). <!-- id:SpxLa0Jx -->

This page describes the **rpc/list-document-collaborators** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:av_BQwYg -->

# Shape <!-- id:QWP-bfOj -->

A **closed struct** with these fields: <!-- id:EdUzp_Jx -->
  - `key` _(required)_: `"ListDocumentCollaborators"` <!-- id:p-hlomXS -->
  - `input` _(required)_: map { 1 fields } <!-- id:L0_8TywV -->
  - `output` _(required)_: [rpc/type/collaborators-payload](./type/collaborators-payload.md) <!-- id:YQbNwJ0I -->

# Depends on <!-- id:vUoviOBz -->

- [rpc/type/collaborators-payload](./type/collaborators-payload.md) <!-- id:7mZJBG2y -->
- [rpc/type/id](./type/id.md) <!-- id:w9pYis7F -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Permissions](../protocol/permissions.md): capabilities, roles and membership.
- [ListCapabilities](./list-capabilities.md): the raw capabilities.
- [Site Member](./type/site-member.md): one member and their role.
