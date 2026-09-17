---
name: Breadcrumb
summary: "One ancestor entry of a document’s path, resolved to a display name."
schemaDefinition: ipfs://bafyreifxhft5lto4yecrnypy2db7tfqfx36l4jelbs5vwmmvider2qhnue
---
One ancestor entry of a document's path, resolved to a display name. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:Hx0g4ljG -->

This page describes the **rpc/type/breadcrumb** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:aIHoVIzJ -->

# Shape <!-- id:7Ey_ElAb -->

A **closed struct** with these fields: <!-- id:GaJkyvmU -->
  - `name` _(required)_: [string](../../string.md) <!-- id:KeXz3K4U -->
  - `path` _(required)_: [string](../../string.md) <!-- id:JM-WnnRQ -->
  - `isMissing`: [boolean](../../boolean.md) <!-- id:O1QZ1BQ3 -->

# Depends on <!-- id:60zxuRgg -->

- [boolean](../../boolean.md) <!-- id:rTTj3a7l -->
- [string](../../string.md) <!-- id:vSJ_3OOj -->
