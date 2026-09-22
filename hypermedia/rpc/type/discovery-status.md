---
name: Discovery Status
summary: "The state of a background discovery task for a resource: pending, found with the resolved version, or failed with the error."
---
The state of a background [discovery](../../protocol/network.md) task for a resource: pending, found with the resolved version, or failed with the error. <!-- id:qgX0_Pnd -->

This page describes the **rpc/type/discovery-status** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:Yrc4tz-K -->

# See also <!-- id:rpVxi04m -->

- [DiscoveryStatus](../discovery-status.md): the method that returns it. <!-- id:NITUrPji -->
- [Network](../../protocol/network.md): discovery and sync. <!-- id:7p9hS2zd -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:kaaw6E3l -->
