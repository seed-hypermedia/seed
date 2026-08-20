---
name: "Comment group"
summary: "A thread of comments grouped for display, with a count of elided replies. A derived read model computed by the Seed daemon/API for clients — not a signed networ"
---

# Comment group

A thread of comments grouped for display, with a count of elided replies. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-comment-group** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `comments` *(required)* — list of [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment)
- `moreCommentsCount` *(required)* — `integer`
- `id` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `type` *(required)* — `string` enum: `commentGroup`

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment)
