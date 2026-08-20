---
name: "Comment list"
summary: "A list of comments plus the metadata payloads of every author involved. A derived read model computed by the Seed daemon/API for clients — not a signed network "
---

# Comment list

A list of comments plus the metadata payloads of every author involved. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-comment-list** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `comments` *(required)* — list of [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment)
- `authors` *(required)* — map ⟨ * : [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload) ⟩

## Depends on

- [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment)
- [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload)
