---
name: "Hypermedia ID (parsed)"
summary: "A parsed hm:// identifier as clients pass it around: account uid, path segments, pinned version, block reference, and origin hints. Fields the URL does not carr"
---

# Hypermedia ID (parsed)

A parsed hm:// identifier as clients pass it around: account uid, path segments, pinned version, block reference, and origin hints. Fields the URL does not carry are null. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-id** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `id` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `uid` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `path` *(required)* — one of list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)
- `version` *(required)* — one of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)
- `blockRef` *(required)* — one of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)
- `blockRange` *(required)* — one of [seed-block-range](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-block-range) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)
- `hostname` *(required)* — one of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)
- `scheme` *(required)* — one of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)
- `latest` — one of [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)

## Depends on

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean)
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-block-range](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-block-range)
