---
name: "Resource: tombstone"
summary: "A resource that was deleted (a tombstone ref). A derived read model computed by the Seed daemon/API for clients — not a signed network blob."
---

# Resource: tombstone

A resource that was deleted (a tombstone ref). A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-resource-tombstone** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `tombstone`
- `id` *(required)* — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)

## Depends on

- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
