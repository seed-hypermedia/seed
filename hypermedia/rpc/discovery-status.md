---
name: "RPC: DiscoveryStatus"
summary: "Reports whether a background discovery task for a resource (uid, path, optional version) is pending, found, or failed."
schemaDefinition: ipfs://bafyreigylgmaycfzuirdccqxgns75l64xhijxxecrvhhzdrfinzm3jdi6u
---
Reports the state of a background discovery task. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:s7Yt7azE -->

This page describes the **rpc/discovery-status** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:suWGAZ3c -->

# Shape <!-- id:pUBQx10M -->

A **closed struct** with these fields: <!-- id:w4vuYwBh -->
  - `key` _(required)_ — `"DiscoveryStatus"` <!-- id:zAkdae6f -->
  - `input` _(required)_ — map { 4 fields } <!-- id:1DDf6AyS -->
  - `output` _(required)_ — [rpc/type/discovery-status](./type/discovery-status.md) <!-- id:H5NLEiwZ -->

# Depends on <!-- id:rIVmhfIF -->

- [boolean](../boolean.md) <!-- id:qYe5vPW7 -->
- [string](../string.md) <!-- id:Ev6PVaa6 -->
- [rpc/type/discovery-status](./type/discovery-status.md) <!-- id:xHV9GDA8 -->
