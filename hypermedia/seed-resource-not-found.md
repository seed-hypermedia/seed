---
name: "Resource: not-found"
summary: "A resource id that resolved to nothing. A derived read model computed by the Seed daemon/API for clients — not a signed network blob."
---

# Resource: not-found

A resource id that resolved to nothing. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-resource-not-found** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `not-found`
- `id` *(required)* — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)

## Depends on

- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
