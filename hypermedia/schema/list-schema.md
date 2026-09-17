---
name: List schema
summary: The variant for a list value, where items types the elements.
schemaDefinition: ipfs://bafyreih2646ketpvmsvcve7pi2cmxfpjdviw5bbcd2wtxkizqb7ukkt4bm
---
A list schema types a [list](./kind.md). `items` is the schema every element must match, and `minItems` and `maxItems` bound the length. <!-- id:EAi5aTCP -->

This document describes the **schema/list-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:HEpps2w- -->

# Shape <!-- id:N5sZel-A -->

A **closed struct** with these fields: <!-- id:ToJn8dIq -->
  - `type` _(required)_: `"list"` <!-- id:wXiDx1hX -->
  - `items`: [schema](../schema.md) <!-- id:YUFWpQYx -->
  - `minItems`: `integer` <!-- id:UorggIMz -->
  - `maxItems`: `integer` <!-- id:8Z5D87tc -->
  - `name`: `string` <!-- id:uT4MH4xg -->
  - `description`: `string` <!-- id:SOgZ0Enf -->
  - `params`: map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:pFgVtJ7z -->

# Depends on <!-- id:pg22iU2j -->

- [schema](../schema.md) <!-- id:6dFto7C5 -->

# See also <!-- id:pHhigo8i -->

- [Map schema](./map-schema.md): the other collection variant. <!-- id:uTUXYN9T -->
- [Struct schema](./struct-schema.md): a map with known fields. <!-- id:8Dhyeba1 -->
- [The data model](./data-model.md): the nine kinds, including `list`. <!-- id:CHTrjczU -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:1erxuP3_ -->
