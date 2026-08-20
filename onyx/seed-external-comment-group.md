---
name: "External comment group"
summary: "A comment thread from ANOTHER document that cites this one, with its target's metadata payload. A derived read model computed by the Seed daemon/API for clients"
---

# External comment group

A comment thread from ANOTHER document that cites this one, with its target's metadata payload. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-external-comment-group** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `comments` *(required)* — list of [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment)
- `moreCommentsCount` *(required)* — `integer`
- `id` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `target` *(required)* — [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload)
- `type` *(required)* — `string` enum: `externalCommentGroup`

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment)
- [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload)
