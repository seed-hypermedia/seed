---
name: "Resource: not-found"
summary: A resource id that resolved to nothing. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreie5zauaaisza4qckotu53mfmpbzoe6xtdhkfrz3jddnyp7ldnc664
---
This document describes the **seed-resource-not-found** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:QMEJXLLW -->

# Shape <!-- id:x4SrnzVB -->

A **closed struct** with these fields: <!-- id:erYiDX2c -->
  - `type` _(required)_ — `string` enum: `not-found` <!-- id:1DwJBRbq -->
  - `id` _(required)_ — [seed-id](./seed-id.md) <!-- id:TaNDKqak -->

# Depends on <!-- id:cW26WYlZ -->

- [seed-id](./seed-id.md) <!-- id:GbP_pjWq -->
