---
name: "Resource: Not Found"
summary: "A resource id that resolved to nothing."
schemaDefinition: ipfs://bafyreicbkwe3glvpilrkkubky3sgrgnmpkewwf7sxcmmnupwoig2tvkr3q
---
This page describes the **rpc/type/resource-not-found** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:QMEJXLLW -->

# Shape <!-- id:x4SrnzVB -->

A **closed struct** with these fields: <!-- id:erYiDX2c -->
  - `type` _(required)_: `"not-found"` <!-- id:1DwJBRbq -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:TaNDKqak -->

# Depends on <!-- id:cW26WYlZ -->

- [rpc/type/id](./id.md) <!-- id:GbP_pjWq -->
