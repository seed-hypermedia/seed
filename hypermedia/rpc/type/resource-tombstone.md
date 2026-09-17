---
name: "Resource: Tombstone"
summary: "A resource that was deleted by a tombstone ref."
schemaDefinition: ipfs://bafyreihcohdtrww5kpo2dbobwwa2lowb46uoftr3bejdxpg5u2uhxvwwgu
---
This page describes the **rpc/type/resource-tombstone** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:J9aXyASx -->

# Shape <!-- id:_bPH9V6J -->

A **closed struct** with these fields: <!-- id:iq6WzySf -->
  - `type` _(required)_: `"tombstone"` <!-- id:r8b5CNgx -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:ZERYE6t9 -->

# Depends on <!-- id:NkOEAKQC -->

- [rpc/type/id](./id.md) <!-- id:iGUIKF_k -->
