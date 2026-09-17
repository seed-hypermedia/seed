---
name: "RPC: DiscoveryStatus"
summary: "Reports whether a background discovery task for a resource (uid, path, optional version) is pending, found, or failed."
schemaDefinition: ipfs://bafyreigylgmaycfzuirdccqxgns75l64xhijxxecrvhhzdrfinzm3jdi6u
---
Reports the state of a background [discovery](../protocol/network.md) task for a resource, given its uid, path and optional version. The task is pending, found or failed, as described by [discovery status](./type/discovery-status.md). <!-- id:s7Yt7azE -->

This page describes the **rpc/discovery-status** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:suWGAZ3c -->

# Shape <!-- id:pUBQx10M -->

A **closed struct** with these fields: <!-- id:w4vuYwBh -->
  - `key` _(required)_: `"DiscoveryStatus"` <!-- id:zAkdae6f -->
  - `input` _(required)_: map { 4 fields } <!-- id:1DDf6AyS -->
  - `output` _(required)_: [rpc/type/discovery-status](./type/discovery-status.md) <!-- id:H5NLEiwZ -->

# Depends on <!-- id:rIVmhfIF -->

- [boolean](../boolean.md) <!-- id:qYe5vPW7 -->
- [string](../string.md) <!-- id:Ev6PVaa6 -->
- [rpc/type/discovery-status](./type/discovery-status.md) <!-- id:xHV9GDA8 -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Network](../protocol/network.md): how peers discover and sync content.
- [Discovery Status](./type/discovery-status.md): the output shape.
- [Resource](./resource.md): fetch the resource once it is found.
