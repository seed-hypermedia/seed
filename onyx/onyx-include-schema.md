---
name: "Reference schema"
summary: "The variant for a reference: a bare include, or an extension when it carries refinements."
---

# Reference schema

The variant for a reference: a bare include, or an extension when it carries refinements.


This document describes the **onyx-include-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `ref` *(required)* — `string`
- `properties` — map ⟨ * : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩
- `required` — list of `string`
- `values` — [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema)
- `items` — [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema)
- `enum` — list of any
- `name` — `string`
- `description` — `string`
- `params` — map ⟨ * : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩
- `args` — map ⟨ * : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩

## Depends on

- [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema)
