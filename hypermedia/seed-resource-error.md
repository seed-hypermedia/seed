---
name: "Resource: error"
summary: A resource that failed to load, with the error message. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreia2igi2irplqa3fjxd4lop2kk4loh7qtefbzjc5zggem2d5ithw2i
---
This document describes the **seed-resource-error** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:GZqGZhzd -->

# Shape <!-- id:oVrER2uX -->

A **closed struct** with these fields: <!-- id:n1mrKLMs -->
  - `type` _(required)_ — `string` enum: `error` <!-- id:1M3e2c10 -->
  - `id` _(required)_ — [seed-id](./seed-id.md) <!-- id:5RWQ79uI -->
  - `message` _(required)_ — [string](./onyx-string.md) <!-- id:Oah0KuFe -->

# Depends on <!-- id:6Gi0Ro6z -->

- [string](./onyx-string.md) <!-- id:cFXjMpA0 -->
- [seed-id](./seed-id.md) <!-- id:24MaXvx- -->
