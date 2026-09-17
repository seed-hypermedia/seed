---
name: Map schema
summary: The variant for a map whose keys are arbitrary and whose values all match the one schema under values, while known fields belong in a struct schema.
schemaDefinition: ipfs://bafyreifwzteb7lzvnv4cjp5adzcah2metpslfpkf6klwvuxzlw4c57gkym
---
A map schema types a [map](./kind.md) whose keys are arbitrary and whose values all match the schema under `values`. A map with known field names is a [struct schema](./struct-schema.md). <!-- id:Tm9kqGPV -->

This document describes the **schema/map-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:N3w6Zkyv -->

# Shape <!-- id:DIHvEvnR -->

A **closed struct** with these fields: <!-- id:tobWRH1P -->
  - `type` _(required)_: `"map"` <!-- id:uoqTZgf3 -->
  - `values`: [schema](../schema.md) <!-- id:orZ1de-U -->
  - `name`: `string` <!-- id:mSTdLOPL -->
  - `description`: `string` <!-- id:aWAzbwvR -->
  - `params`: map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:6fKAJWXB -->

# Depends on <!-- id:VZpWi77O -->

- [schema](../schema.md) <!-- id:0VHAY2ye -->

# See also <!-- id:1hEZjNqJ -->

- [Struct schema](./struct-schema.md): known fields, optionally open to extra keys. <!-- id:9X94xAyV -->
- [Closed map](./closed-map.md): a struct that rejects keys it does not name. <!-- id:EodJknWe -->
- [List schema](./list-schema.md): the other collection variant. <!-- id:suYXW37r -->
- [The data model](./data-model.md): the nine kinds, including `map`. <!-- id:Dt3sByIm -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:YsM8mUN4 -->
