---
name: List schema
summary: The variant for a list value; items types the elements.
schemaDefinition: ipfs://bafyreibcrswycgshpigpofccz5imuw2s4ooe7uyr35msv225gnjle7gs6q
---
This document describes the **hypermedia-list-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HEpps2w- -->

# Shape <!-- id:N5sZel-A -->

A **closed struct** with these fields: <!-- id:ToJn8dIq -->
  - `type` _(required)_ — `string` enum: `list` <!-- id:wXiDx1hX -->
  - `items` — [schema](./hypermedia-schema.md) <!-- id:YUFWpQYx -->
  - `minItems` — `integer` <!-- id:UorggIMz -->
  - `maxItems` — `integer` <!-- id:8Z5D87tc -->
  - `name` — `string` <!-- id:uT4MH4xg -->
  - `description` — `string` <!-- id:SOgZ0Enf -->
  - `params` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:pFgVtJ7z -->

# Depends on <!-- id:pg22iU2j -->

- [schema](./hypermedia-schema.md) <!-- id:6dFto7C5 -->
