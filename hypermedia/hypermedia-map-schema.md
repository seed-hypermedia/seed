---
name: Map schema
summary: The variant for a map — arbitrary keys whose values all match one schema (values). Known fields belong to a struct schema.
schemaDefinition: ipfs://bafyreih6da7jeedfod2dgvmlvc2gtzh67cxnqntp4acvvlqb62j37h5bqa
---
This document describes the **hypermedia-map-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:N3w6Zkyv -->

# Shape <!-- id:DIHvEvnR -->

A **closed struct** with these fields (`properties` and `required` remain accepted for schemas published before struct existed): <!-- id:tobWRH1P -->
  - `type` _(required)_ — `string` enum: `map` <!-- id:uoqTZgf3 -->
  - `properties` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:X3L1FJjV -->
  - `required` — list of `string` <!-- id:MK6hvmur -->
  - `values` — [schema](./hypermedia-schema.md) <!-- id:orZ1de-U -->
  - `name` — `string` <!-- id:mSTdLOPL -->
  - `description` — `string` <!-- id:aWAzbwvR -->
  - `params` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:6fKAJWXB -->

# Depends on <!-- id:VZpWi77O -->

- [schema](./hypermedia-schema.md) <!-- id:0VHAY2ye -->
