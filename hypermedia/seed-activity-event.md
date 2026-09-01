---
name: "Activity event"
summary: "One event of the activity feed. The event union is not yet pinned down schema-side, so this is an open map — tightening it is tracked follow-up work. A derived "
---

# Activity event

One event of the activity feed. The event union is not yet pinned down schema-side, so this is an open map — tightening it is tracked follow-up work. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-activity-event** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

An **open map** — every value: [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any).

## Depends on

- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any)
