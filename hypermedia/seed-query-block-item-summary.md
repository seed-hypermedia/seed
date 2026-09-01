---
name: "Query block item summary"
summary: "Per-result interaction counts a Query block shows on its cards. A derived read model computed by the Seed daemon/API for clients — not a signed network blob."
---

# Query block item summary

Per-result interaction counts a Query block shows on its cards. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-query-block-item-summary** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `comments` *(required)* — `integer`
- `children` — `integer`
- `authorUids` — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
