---
name: "Union schema"
summary: "The variant for a union — a value matching any one of several alternatives (anyOf)."
---

# Union schema

The variant for a union — a value matching any one of several alternatives (anyOf).


This document describes the **onyx-union-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `anyOf` *(required)* — list of [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
- `name` — `string`
- `description` — `string`
- `params` — map ⟨ * : [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema) ⟩

## Depends on

- [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
