---
name: "Scalar schema"
summary: "The variant for a scalar value (null, boolean, integer, float, string, bytes), optionally restricted by enum."
---

# Scalar schema

The variant for a scalar value (null, boolean, integer, float, string, bytes), optionally restricted by enum.


This document describes the **onyx-scalar-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `null` `boolean` `integer` `float` `string` `bytes`
- `enum` — list of any
- `minLength` — `integer`
- `maxLength` — `integer`
- `pattern` — `string`
- `minimum` — `integer`
- `maximum` — `integer`
- `name` — `string`
- `description` — `string`
- `params` — map ⟨ * : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩

## Depends on

- [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema)
