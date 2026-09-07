---
name: "Example: Constrained record"
summary: "Exercises the value constraints: string length + pattern, numeric bounds, and list size."
schemaDefinition: ipfs://bafyreihfhovizkq3wf2f2kezrk3hvzk2jjf5ct534vm4tjsed4v6dc6pvu
---
This document describes the **example-constrained** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:7mil43v3 -->

# Shape <!-- id:u0bp8N-O -->

A **closed struct** with these fields: <!-- id:XZkJ0jr0 -->
  - `username` _(required)_ — `string` <!-- id:baxMEaLA -->
  - `score` _(required)_ — `integer` <!-- id:MU1mTe3O -->
  - `tags` — list of [string](./hypermedia-string.md) <!-- id:mA94BPqd -->

# Depends on <!-- id:OQmAkkji -->

- [string](./hypermedia-string.md) <!-- id:iav6y69T -->
