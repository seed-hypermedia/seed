---
name: "Map schema"
summary: "The variant for a map value — a closed struct (via properties) or an open map (via values)."
---

# Map schema

The variant for a map value — a closed struct (via properties) or an open map (via values).


This document describes the **onyx-map-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `map`
- `properties` — map ⟨ * : [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema) ⟩
- `required` — list of `string`
- `values` — [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
- `name` — `string`
- `description` — `string`
- `params` — map ⟨ * : [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema) ⟩

## Depends on

- [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
