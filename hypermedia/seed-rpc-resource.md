---
name: "RPC: Resource"
summary: "Fetches a resource (document, comment, redirect, …) by parsed id. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fiel"
schemaDefinition: ipfs://bafyreict2mtqxurmi5l3jp5zqbjljmz62gornrlaknyboy3oac74ttownq
---
Fetches a resource (document, comment, redirect, …) by parsed id. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:0FgdDO0r -->

This document describes the **seed-rpc-resource** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qsZY_yJS -->

# Shape <!-- id:wRYJGS_e -->

A **closed struct** with these fields: <!-- id:utly96z5 -->
  - `key` _(required)_ — `string` enum: `Resource` <!-- id:UToawi30 -->
  - `input` _(required)_ — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:FVQ72Tj4 -->
  - `output` _(required)_ — [seed-resource](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource) <!-- id:-cmT97ah -->

# Depends on <!-- id:jnPQmqvS -->

- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:gdMZoKdz -->
- [seed-resource](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource) <!-- id:Qt87mW4L -->
