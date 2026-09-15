---
name: List schema
summary: The variant for a list value; items types the elements.
schemaDefinition: ipfs://bafyreiamzca5wxtomu75uywuk4z2c7mlq2vvnd7sib6polp56kx42f3iyi
---
This document describes the **schema/list-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HEpps2w- -->

# Shape <!-- id:N5sZel-A -->

A **closed struct** with these fields: <!-- id:ToJn8dIq -->
  - `type` _(required)_ — `"list"` <!-- id:wXiDx1hX -->
  - `items` — [schema](../schema.md) <!-- id:YUFWpQYx -->
  - `minItems` — `integer` <!-- id:UorggIMz -->
  - `maxItems` — `integer` <!-- id:8Z5D87tc -->
  - `name` — `string` <!-- id:uT4MH4xg -->
  - `description` — `string` <!-- id:SOgZ0Enf -->
  - `params` — map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:pFgVtJ7z -->

# Depends on <!-- id:pg22iU2j -->

- [schema](../schema.md) <!-- id:6dFto7C5 -->
