---
name: "Resource: Not Found"
summary: A resource id that resolved to nothing. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreih46r2pogxi7lpvihpto5zd77j53lg5dxm2yw3vpb7fsocacjbqiq
---
This document describes the **rpc/type/resource-not-found** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:QMEJXLLW -->

# Shape <!-- id:x4SrnzVB -->

A **closed struct** with these fields: <!-- id:erYiDX2c -->
  - `type` _(required)_ — `"not-found"` <!-- id:1DwJBRbq -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:TaNDKqak -->

# Depends on <!-- id:cW26WYlZ -->

- [rpc/type/id](./id.md) <!-- id:GbP_pjWq -->
