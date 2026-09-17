---
name: "Resource: Not Found"
summary: "A resource id that resolved to nothing."
schemaDefinition: ipfs://bafyreicbkwe3glvpilrkkubky3sgrgnmpkewwf7sxcmmnupwoig2tvkr3q
---
A [resource](../../glossary.md) id that resolved to nothing. It is one state of [rpc/type/resource](./resource.md).

This page describes the **rpc/type/resource-not-found** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:QMEJXLLW -->

# Shape <!-- id:x4SrnzVB -->

A **closed struct** with these fields: <!-- id:erYiDX2c -->
  - `type` _(required)_: `"not-found"` <!-- id:1DwJBRbq -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:TaNDKqak -->

# Depends on <!-- id:cW26WYlZ -->

- [rpc/type/id](./id.md) <!-- id:GbP_pjWq -->

# See also

- [Resource](./resource.md): every resource state.
- [Resource: Tombstone](./resource-tombstone.md): a deleted resource.
- [DiscoveryStatus](../discovery-status.md): check whether discovery is still looking.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
