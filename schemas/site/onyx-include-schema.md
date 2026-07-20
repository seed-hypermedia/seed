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
- `properties` — map ⟨ * : [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema) ⟩
- `required` — list of `string`
- `values` — [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
- `items` — [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
- `enum` — list of any
- `name` — `string`
- `description` — `string`
- `params` — map ⟨ * : [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema) ⟩
- `args` — map ⟨ * : [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema) ⟩

## Depends on

- [onyx-schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-schema)
