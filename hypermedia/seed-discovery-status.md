---
name: "Discovery status"
summary: "The state of a background discovery task for a resource: pending, found (with the resolved version), or failed (with the error). A derived read model computed b"
---

# Discovery status

The state of a background discovery task for a resource: pending, found (with the resolved version), or failed (with the error). A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-discovery-status** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `state` *(required)* — `string` enum: `pending` `found` `failed`
- `version` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `error` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
