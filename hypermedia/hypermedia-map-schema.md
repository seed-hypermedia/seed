---
name: Map schema
summary: The variant for a map — arbitrary keys whose values all match one schema (values). Known fields belong to a struct schema.
schemaDefinition: ipfs://bafyreibgqfplma6ejwiabzlrjdjbhxgvisfmw2v4nbwxtakvs27zsnqaly
---
This document describes the **hypermedia-map-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:N3w6Zkyv -->

# Shape <!-- id:DIHvEvnR -->

A **closed struct** with these fields: <!-- id:tobWRH1P -->
  - `type` _(required)_ — `"map"` <!-- id:uoqTZgf3 -->
  - `values` — [schema](./hypermedia-schema.md) <!-- id:orZ1de-U -->
  - `name` — `string` <!-- id:mSTdLOPL -->
  - `description` — `string` <!-- id:aWAzbwvR -->
  - `params` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:6fKAJWXB -->

# Depends on <!-- id:VZpWi77O -->

- [schema](./hypermedia-schema.md) <!-- id:0VHAY2ye -->
