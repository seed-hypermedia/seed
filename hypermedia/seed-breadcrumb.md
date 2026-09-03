---
name: Breadcrumb
summary: One ancestor entry of a document's path, resolved to a display name. A derived read model computed by the Seed daemon/API for clients — not a signed network blo
schemaDefinition: ipfs://bafyreifn73ov2r3o7kwwoillxmazge3tmavdcdaa7o4qalugmkynhhacbe
---
One ancestor entry of a document's path, resolved to a display name. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:Hx0g4ljG -->

This document describes the **seed-breadcrumb** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:aIHoVIzJ -->

# Shape <!-- id:7Ey_ElAb -->

A **closed struct** with these fields: <!-- id:GaJkyvmU -->
  - `name` _(required)_ — [string](./onyx-string.md) <!-- id:KeXz3K4U -->
  - `path` _(required)_ — [string](./onyx-string.md) <!-- id:JM-WnnRQ -->
  - `isMissing` — [boolean](./onyx-boolean.md) <!-- id:O1QZ1BQ3 -->

# Depends on <!-- id:60zxuRgg -->

- [boolean](./onyx-boolean.md) <!-- id:rTTj3a7l -->
- [string](./onyx-string.md) <!-- id:vSJ_3OOj -->
