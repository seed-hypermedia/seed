---
name: "RPC: DiscoveryStatus"
summary: "Reports the state of a background discovery task. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you"
schemaDefinition: ipfs://bafyreia5n5qrr5zyjovggff6t7v356n6nhnscqrt2c3yilyyvvn3avd2ya
---
Reports the state of a background discovery task. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:s7Yt7azE -->

This document describes the **rpc/discovery-status** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:suWGAZ3c -->

# Shape <!-- id:pUBQx10M -->

A **closed struct** with these fields: <!-- id:w4vuYwBh -->
  - `key` _(required)_ — `"DiscoveryStatus"` <!-- id:zAkdae6f -->
  - `input` _(required)_ — map { 4 fields } <!-- id:1DDf6AyS -->
  - `output` _(required)_ — [rpc/type/discovery-status](./type/discovery-status.md) <!-- id:H5NLEiwZ -->

# Depends on <!-- id:rIVmhfIF -->

- [boolean](../schema/boolean.md) <!-- id:qYe5vPW7 -->
- [string](../schema/string.md) <!-- id:Ev6PVaa6 -->
- [rpc/type/discovery-status](./type/discovery-status.md) <!-- id:xHV9GDA8 -->
