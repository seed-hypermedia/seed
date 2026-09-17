---
name: "Resource: Error"
summary: "A resource that failed to load, carrying its id and the error message."
schemaDefinition: ipfs://bafyreie7khxrb2e3sf62vzlpro6twt4fkalxpy27xmucxdxz3vx2ckxofq
---
A [resource](../../glossary.md) that failed to load, with its [parsed id](./id.md) and the error message. It is one state of [rpc/type/resource](./resource.md).

This page describes the **rpc/type/resource-error** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:GZqGZhzd -->

# Shape <!-- id:oVrER2uX -->

A **closed struct** with these fields: <!-- id:n1mrKLMs -->
  - `type` _(required)_: `"error"` <!-- id:1M3e2c10 -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:5RWQ79uI -->
  - `message` _(required)_: [string](../../string.md) <!-- id:Oah0KuFe -->

# Depends on <!-- id:6Gi0Ro6z -->

- [string](../../string.md) <!-- id:cFXjMpA0 -->
- [rpc/type/id](./id.md) <!-- id:24MaXvx- -->

# See also

- [Resource](./resource.md): every resource state.
- [Resource: Not Found](./resource-not-found.md): the not-found state.
- [Seed API](../../build/web-api.md): errors at the HTTP level.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
