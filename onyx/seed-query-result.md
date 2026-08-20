---
name: "Query result"
summary: "The documents a query matched, listed under the queried id. A derived read model computed by the Seed daemon/API for clients — not a signed network blob."
---

# Query result

The documents a query matched, listed under the queried id. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-query-result** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `in` *(required)* — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
- `results` *(required)* — list of [seed-document-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document-info)
- `mode` — `string` enum: `Children` `AllDescendants`

## Depends on

- [seed-document-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document-info)
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
