---
name: "Resource: Not Found"
summary: A resource id that resolved to nothing.
---
A [resource](../../glossary.md) id that resolved to nothing. It is one state of [rpc/type/resource](./resource.md). <!-- id:3NRGF4vu -->

This page describes the **rpc/type/resource-not-found** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:QMEJXLLW -->

# See also <!-- id:gy6U_J5G -->

- [Resource](./resource.md): every resource state. <!-- id:A__wbHmt -->
- [Resource: Tombstone](./resource-tombstone.md): a deleted resource. <!-- id:GY0dbsgA -->
- [DiscoveryStatus](../discovery-status.md): check whether discovery is still looking. <!-- id:Is86ZPb- -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:RFHFOPkg -->
