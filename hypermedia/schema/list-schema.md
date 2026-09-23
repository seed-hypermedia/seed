---
name: List schema
summary: The variant for a list value, where items types the elements.
---
A list schema types a [list](./kind.md). `items` is the schema every element must match, and `minItems` and `maxItems` bound the length. <!-- id:EAi5aTCP -->

This document describes the **schema/list-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:HEpps2w- -->

# See also <!-- id:pHhigo8i -->

- [Map schema](./map-schema.md): the other collection variant. <!-- id:uTUXYN9T -->
- [Struct schema](./struct-schema.md): a map with known fields. <!-- id:8Dhyeba1 -->
- [The data model](./data-model.md): the nine kinds, including `list`. <!-- id:CHTrjczU -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:1erxuP3_ -->
