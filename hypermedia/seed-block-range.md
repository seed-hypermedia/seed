---
name: "Block range"
summary: "A selection within a block: either character offsets (start/end) or the whole block expanded. A derived read model computed by the Seed daemon/API for clients —"
---

# Block range

A selection within a block: either character offsets (start/end) or the whole block expanded. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-block-range** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `start` — `integer`
- `end` — `integer`
- `expanded` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean)

## Depends on

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean)
