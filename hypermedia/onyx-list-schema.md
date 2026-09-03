---
name: List schema
summary: The variant for a list value; items types the elements.
schemaDefinition: ipfs://bafyreifrjfhsay2v4rdmvhzioxxnqjd6wfr4xr65s36cd2kzpbeukwvbqu
---
This document describes the **onyx-list-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HEpps2w- -->

# Shape <!-- id:N5sZel-A -->

A **closed struct** with these fields: <!-- id:ToJn8dIq -->
  - `type` _(required)_ — `string` enum: `list` <!-- id:wXiDx1hX -->
  - `items` — [schema](./onyx-schema.md) <!-- id:YUFWpQYx -->
  - `minItems` — `integer` <!-- id:UorggIMz -->
  - `maxItems` — `integer` <!-- id:8Z5D87tc -->
  - `name` — `string` <!-- id:uT4MH4xg -->
  - `description` — `string` <!-- id:SOgZ0Enf -->
  - `params` — map ⟨ \* : [schema](./onyx-schema.md) ⟩ <!-- id:pFgVtJ7z -->

# Depends on <!-- id:pg22iU2j -->

- [schema](./onyx-schema.md) <!-- id:6dFto7C5 -->
