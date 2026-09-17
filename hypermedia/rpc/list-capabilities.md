---
name: "RPC: ListCapabilities"
summary: "Returns the raw capabilities granted on a target document, given its id."
schemaDefinition: ipfs://bafyreidhif2mdldha6ybmqqc3dlt4wssfrdx42eqxyfu326rn6cjkf22sm
---
Lists the [capabilities](../protocol/permissions.md) granted on a target [document](../protocol/documents.md), given its id. Each one comes back as a [raw capability](./type/raw-capability.md). <!-- id:L8_yo2Q9 -->

This page describes the **rpc/list-capabilities** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:IqUUi73s -->

# Shape <!-- id:YK3vwxSB -->

A **closed struct** with these fields: <!-- id:RQY-bLCd -->
  - `key` _(required)_: `"ListCapabilities"` <!-- id:6HrUMgDQ -->
  - `input` _(required)_: map { 1 fields } <!-- id:2dxY9qtk -->
  - `output` _(required)_: map { 1 fields } <!-- id:xLkK3UYa -->

# Depends on <!-- id:4XBJ0Wiw -->

- [rpc/type/id](./type/id.md) <!-- id:QRcN79AB -->
- [rpc/type/raw-capability](./type/raw-capability.md) <!-- id:nE7lE0DM -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Permissions](../protocol/permissions.md): capabilities, roles and delegation.
- [Capability](../capability.md): the signed capability blob.
- [ListDocumentCollaborators](./list-document-collaborators.md): the resolved collaboration picture.
