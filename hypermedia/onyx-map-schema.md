---
name: Map schema
summary: The variant for a map value — a closed struct (via properties) or an open map (via values).
schemaDefinition: ipfs://bafyreihqmvqoisv3lf6pi7hbagbw36zhho46paznbuqffz6c3qjt6ftzsi
---
This document describes the **onyx-map-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:N3w6Zkyv -->

# Shape <!-- id:DIHvEvnR -->

A **closed struct** with these fields: <!-- id:tobWRH1P -->
  - `type` _(required)_ — `string` enum: `map` <!-- id:uoqTZgf3 -->
  - `properties` — map ⟨ \* : [schema](./onyx-schema.md) ⟩ <!-- id:X3L1FJjV -->
  - `required` — list of `string` <!-- id:MK6hvmur -->
  - `values` — [schema](./onyx-schema.md) <!-- id:orZ1de-U -->
  - `name` — `string` <!-- id:mSTdLOPL -->
  - `description` — `string` <!-- id:aWAzbwvR -->
  - `params` — map ⟨ \* : [schema](./onyx-schema.md) ⟩ <!-- id:6fKAJWXB -->

# Depends on <!-- id:VZpWi77O -->

- [schema](./onyx-schema.md) <!-- id:0VHAY2ye -->
