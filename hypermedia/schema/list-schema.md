---
name: List schema
summary: The variant for a list value, where items types the elements.
---
A list schema describes a [list](../list.md). `items` is the schema that every element must match. `minItems` and `maxItems` set the shortest and the longest length allowed. For example, `{"type": "hm://hyper.media/list", "items": {"type": "hm://hyper.media/string"}}` is a list of strings. <!-- id:EAi5aTCP -->

This page defines the **schema/list-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:HEpps2w- -->

# See also <!-- id:pHhigo8i -->

- [Map schema](./map-schema.md): the other collection variant. <!-- id:uTUXYN9T -->
- [Struct schema](./struct-schema.md): a map with known fields. <!-- id:8Dhyeba1 -->
- [The data model](./data-model.md): the nine kinds, including `list`. <!-- id:CHTrjczU -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:1erxuP3_ -->
