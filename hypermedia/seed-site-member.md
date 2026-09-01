---
name: "Site member"
summary: "One member of a site with their effective role. A derived read model computed by the Seed daemon/API for clients — not a signed network blob."
---

# Site member

One member of a site with their effective role. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-site-member** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `account` *(required)* — [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
- `role` *(required)* — `string` enum: `owner` `writer` `member`

## Depends on

- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
