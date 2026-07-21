---
name: "Link schema"
summary: "The variant for a link (CID), optionally naming the expected target type."
---

# Link schema

The variant for a link (CID), optionally naming the expected target type.


This document describes the **onyx-link-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `link`
- `ref` — `string`
- `name` — `string`
- `description` — `string`
- `params` — map ⟨ * : [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema) ⟩

## Depends on

- [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
