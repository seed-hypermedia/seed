---
name: "Parsed fragment"
summary: "A parsed URL fragment addressing a block (and optionally a range inside it). A derived read model computed by the Seed daemon/API for clients — not a signed net"
---

# Parsed fragment

A parsed URL fragment addressing a block (and optionally a range inside it). A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-parsed-fragment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

**Extends** [seed-block-range](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-block-range) with these added fields:

- `blockId` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-block-range](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-block-range)
