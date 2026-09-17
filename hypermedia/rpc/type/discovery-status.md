---
name: Discovery Status
summary: "The state of a background discovery task for a resource: pending, found with the resolved version, or failed with the error."
schemaDefinition: ipfs://bafyreig5qnttwnusga7cz46pf55yo53hjuzkcf2ssd6lxqo6darzfyj2ny
---
The state of a background [discovery](../../protocol/network.md) task for a resource: pending, found with the resolved version, or failed with the error. <!-- id:qgX0_Pnd -->

This page describes the **rpc/type/discovery-status** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:Yrc4tz-K -->

# Shape <!-- id:5S7wQzcJ -->

A **closed struct** with these fields: <!-- id:30yArQuX -->
  - `state` _(required)_: one of `"pending"` | `"found"` | `"failed"` <!-- id:9LZFnDbh -->
  - `version`: [string](../../string.md) <!-- id:8vEiaWJC -->
  - `error`: [string](../../string.md) <!-- id:7izs2ZlP -->

# Depends on <!-- id:2Ac_QMa3 -->

- [string](../../string.md) <!-- id:mvuguHT_ -->

# See also <!-- id:rpVxi04m -->

- [DiscoveryStatus](../discovery-status.md): the method that returns it. <!-- id:NITUrPji -->
- [Network](../../protocol/network.md): discovery and sync. <!-- id:7p9hS2zd -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:kaaw6E3l -->
