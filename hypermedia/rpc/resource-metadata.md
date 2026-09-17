---
name: "RPC: ResourceMetadata"
summary: Returns only the metadata payload of a resource, given its parsed id.
schemaDefinition: ipfs://bafyreiain6czrhflzyx6v62c6zcbquudbbkdmakxzixktvk5r7qocy5j44
---
Fetches only the [metadata](../metadata.md) of a [resource](../glossary.md), given its [parsed id](./type/id.md). The result is a [metadata payload](./type/metadata-payload.md). <!-- id:C2feHa74 -->

This page describes the **rpc/resource-metadata** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:20rKl8KP -->

# Shape <!-- id:_ep6ugnk -->

A **closed struct** with these fields: <!-- id:5AAU-kvD -->
  - `key` _(required)_: `"ResourceMetadata"` <!-- id:HerqY_zj -->
  - `input` _(required)_: [rpc/type/id](./type/id.md) <!-- id:1XN_xHq6 -->
  - `output` _(required)_: [rpc/type/metadata-payload](./type/metadata-payload.md) <!-- id:EGkLBWqc -->

# Depends on <!-- id:OV283JHj -->

- [rpc/type/id](./type/id.md) <!-- id:_dSHDZrd -->
- [rpc/type/metadata-payload](./type/metadata-payload.md) <!-- id:x5jQfnso -->

# See also <!-- id:FPSmawDq -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:szp1UmJU -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:i2zrOeuj -->
- [RPC](./method.md): every method in one union. <!-- id:BvCbPmAm -->
- [Resource](./resource.md): fetch the whole resource. <!-- id:kh4U9QlB -->
- [Metadata](../metadata.md): every metadata key. <!-- id:n5qjw3wG -->
- [Hypermedia URLs](../protocol/urls.md): the ids this method takes. <!-- id:iCEGsjd1 -->
