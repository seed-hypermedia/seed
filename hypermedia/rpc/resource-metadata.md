---
name: "RPC: ResourceMetadata"
summary: Returns only the metadata payload of a resource, given its parsed id.
---
Fetches only the [metadata](../metadata.md) of a [resource](../glossary.md), given its [parsed id](./type/id.md). The result is a [metadata payload](./type/metadata-payload.md). <!-- id:C2feHa74 -->

This page describes the **rpc/resource-metadata** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:20rKl8KP -->

# See also <!-- id:FPSmawDq -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:szp1UmJU -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:i2zrOeuj -->
- [RPC](./method.md): every method in one union. <!-- id:BvCbPmAm -->
- [Resource](./resource.md): fetch the whole resource. <!-- id:kh4U9QlB -->
- [Metadata](../metadata.md): every metadata key. <!-- id:n5qjw3wG -->
- [Hypermedia URLs](../protocol/urls.md): the ids this method takes. <!-- id:iCEGsjd1 -->
