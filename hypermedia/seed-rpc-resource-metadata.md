---
name: "RPC: ResourceMetadata"
summary: "Fetches only a resource's metadata payload. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass;"
schemaDefinition: ipfs://bafyreibw7mb4rrqbft3p3nfiix3nfjb5jwtqj2mkuj7jn6pfz4l5fk4scm
---
Fetches only a resource's metadata payload. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:C2feHa74 -->

This document describes the **seed-rpc-resource-metadata** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:20rKl8KP -->

# Shape <!-- id:_ep6ugnk -->

A **closed struct** with these fields: <!-- id:5AAU-kvD -->
  - `key` _(required)_ — `string` enum: `ResourceMetadata` <!-- id:HerqY_zj -->
  - `input` _(required)_ — [seed-id](./seed-id.md) <!-- id:1XN_xHq6 -->
  - `output` _(required)_ — [seed-metadata-payload](./seed-metadata-payload.md) <!-- id:EGkLBWqc -->

# Depends on <!-- id:OV283JHj -->

- [seed-id](./seed-id.md) <!-- id:_dSHDZrd -->
- [seed-metadata-payload](./seed-metadata-payload.md) <!-- id:x5jQfnso -->
