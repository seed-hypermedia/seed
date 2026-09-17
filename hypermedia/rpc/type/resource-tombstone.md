---
name: "Resource: Tombstone"
summary: "A resource that was deleted by a tombstone ref."
schemaDefinition: ipfs://bafyreihcohdtrww5kpo2dbobwwa2lowb46uoftr3bejdxpg5u2uhxvwwgu
---
A [resource](../../glossary.md) that a tombstone [ref](../../ref.md) deleted. It is one state of [rpc/type/resource](./resource.md).

This page describes the **rpc/type/resource-tombstone** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:J9aXyASx -->

# Shape <!-- id:_bPH9V6J -->

A **closed struct** with these fields: <!-- id:iq6WzySf -->
  - `type` _(required)_: `"tombstone"` <!-- id:r8b5CNgx -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:ZERYE6t9 -->

# Depends on <!-- id:NkOEAKQC -->

- [rpc/type/id](./id.md) <!-- id:iGUIKF_k -->

# See also

- [Resource](./resource.md): every resource state.
- [Documents](../../protocol/documents.md): tombstones and deletion.
- [Resource: Not Found](./resource-not-found.md): the not-found state.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
