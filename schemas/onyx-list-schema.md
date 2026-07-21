---
name: "List schema"
summary: "The variant for a list value; items types the elements."
---

# List schema

The variant for a list value; items types the elements.


This document describes the **onyx-list-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `list`
- `items` — [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
- `minItems` — `integer`
- `maxItems` — `integer`
- `name` — `string`
- `description` — `string`
- `params` — map ⟨ * : [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema) ⟩

## Depends on

- [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
