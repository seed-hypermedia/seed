---
name: Map schema
summary: The variant for a map whose keys are arbitrary and whose values all match the one schema under values, while known fields belong in a struct schema.
---
A map schema types a [map](./kind.md) whose keys are arbitrary and whose values all match the schema under `values`. A map with known field names is a [struct schema](./struct-schema.md). <!-- id:Tm9kqGPV -->

This document describes the **schema/map-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:N3w6Zkyv -->

# See also <!-- id:1hEZjNqJ -->

- [Struct schema](./struct-schema.md): known fields, optionally open to extra keys. <!-- id:9X94xAyV -->
- [Closed map](./closed-map.md): a struct that rejects keys it does not name. <!-- id:EodJknWe -->
- [List schema](./list-schema.md): the other collection variant. <!-- id:suYXW37r -->
- [The data model](./data-model.md): the nine kinds, including `map`. <!-- id:Dt3sByIm -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:YsM8mUN4 -->
