---
name: "RPC: ListCapabilities"
summary: "Lists raw capabilities granted on a target. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass;"
schemaDefinition: ipfs://bafyreieagsuztga7fw736clulw4o6i5s2y542fsbwibufv3z7kucawxkpm
---
Lists raw capabilities granted on a target. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:L8_yo2Q9 -->

This document describes the **seed-rpc-list-capabilities** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:IqUUi73s -->

# Shape <!-- id:YK3vwxSB -->

A **closed struct** with these fields: <!-- id:RQY-bLCd -->
  - `key` _(required)_ — `string` enum: `ListCapabilities` <!-- id:6HrUMgDQ -->
  - `input` _(required)_ — map { 1 fields } <!-- id:2dxY9qtk -->
  - `output` _(required)_ — map { 1 fields } <!-- id:xLkK3UYa -->

# Depends on <!-- id:4XBJ0Wiw -->

- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:QRcN79AB -->
- [seed-raw-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-raw-capability) <!-- id:nE7lE0DM -->
