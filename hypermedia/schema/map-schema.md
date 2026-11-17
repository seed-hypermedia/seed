---
name: Map schema
summary: The variant for a map whose keys are arbitrary and whose values all match the one schema under values, while known fields belong in a struct schema.
---
A map schema describes a [map](../map.md) whose keys are not known in advance. Any key is allowed, and every value must match the one schema under `values`. For example, a map from tag names to counts has `values` set to the integer schema. When the field names are known, use a [struct schema](./struct-schema.md). <!-- id:Tm9kqGPV -->

This page defines the **schema/map-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:N3w6Zkyv -->

# See also <!-- id:1hEZjNqJ -->

- [Struct schema](./struct-schema.md): known fields, optionally open to extra keys. <!-- id:9X94xAyV -->
- [Closed map](./closed-map.md): a [struct](../struct.md) that rejects keys it does not name. <!-- id:EodJknWe -->
- [List schema](./list-schema.md): the other collection variant. <!-- id:suYXW37r -->
- [The data model](./data-model.md): the nine kinds, including `map`. <!-- id:Dt3sByIm -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:YsM8mUN4 -->
