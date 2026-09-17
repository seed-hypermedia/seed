---
name: "Resource: Error"
summary: "A resource that failed to load, carrying its id and the error message."
schemaDefinition: ipfs://bafyreie7khxrb2e3sf62vzlpro6twt4fkalxpy27xmucxdxz3vx2ckxofq
---
This page describes the **rpc/type/resource-error** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:GZqGZhzd -->

# Shape <!-- id:oVrER2uX -->

A **closed struct** with these fields: <!-- id:n1mrKLMs -->
  - `type` _(required)_ — `"error"` <!-- id:1M3e2c10 -->
  - `id` _(required)_ — [rpc/type/id](./id.md) <!-- id:5RWQ79uI -->
  - `message` _(required)_ — [string](../../string.md) <!-- id:Oah0KuFe -->

# Depends on <!-- id:6Gi0Ro6z -->

- [string](../../string.md) <!-- id:cFXjMpA0 -->
- [rpc/type/id](./id.md) <!-- id:24MaXvx- -->
