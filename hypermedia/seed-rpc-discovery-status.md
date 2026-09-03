---
name: "RPC: DiscoveryStatus"
summary: "Reports the state of a background discovery task. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you"
schemaDefinition: ipfs://bafyreid2glr7b7hgfrlpxvjp2r2incg6b4xgudzlqg5sp2d6lzdvkqrvmi
---
Reports the state of a background discovery task. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:s7Yt7azE -->

This document describes the **seed-rpc-discovery-status** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:suWGAZ3c -->

# Shape <!-- id:pUBQx10M -->
A **closed struct** with these fields: <!-- id:w4vuYwBh -->
  - `key` _(required)_ — `string` enum: `DiscoveryStatus` <!-- id:zAkdae6f -->
  - `input` _(required)_ — map { 4 fields } <!-- id:1DDf6AyS -->
  - `output` _(required)_ — [seed-discovery-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-discovery-status) <!-- id:H5NLEiwZ -->

# Depends on <!-- id:rIVmhfIF -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:qYe5vPW7 -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Ev6PVaa6 -->
- [seed-discovery-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-discovery-status) <!-- id:xHV9GDA8 -->