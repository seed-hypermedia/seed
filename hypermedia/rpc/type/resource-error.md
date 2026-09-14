---
name: "Resource: Error"
summary: A resource that failed to load, with the error message. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.
schemaDefinition: ipfs://bafyreicxsb7tdglldq3e7lrbevz2yqhkdhrcailygmkjfo2gb6qnlan4hq
---
This document describes the **rpc/type/resource-error** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:GZqGZhzd -->

# Shape <!-- id:oVrER2uX -->

A **closed struct** with these fields: <!-- id:n1mrKLMs -->
  - `type` _(required)_ — `"error"` <!-- id:1M3e2c10 -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:5RWQ79uI -->
  - `message` _(required)_ — [string](../../schema/string.md) <!-- id:Oah0KuFe -->

# Depends on <!-- id:6Gi0Ro6z -->

- [string](../../schema/string.md) <!-- id:cFXjMpA0 -->
- [rpc/type/id](./id.md) <!-- id:24MaXvx- -->
