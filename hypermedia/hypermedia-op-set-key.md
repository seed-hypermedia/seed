---
name: "SetKey op"
summary: "Deprecated: set a single flat metadata key to a value."
---

# SetKey op

Deprecated: set a single flat metadata key to a value.


This document describes the **hypermedia-op-set-key** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `SetKey`
- `key` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `value` — [hypermedia-value](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-value)

## Depends on

- [hypermedia-value](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-value)
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
