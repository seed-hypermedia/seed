---
name: Union schema
summary: The variant for a union — a value matching any one of several alternatives (anyOf).
schemaDefinition: ipfs://bafyreidguchk5afl3g4hlmdbyoaepbsxbcbgxq7ddses4hboi34g67ne3q
---
This document describes the **hypermedia-anyof** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:C3PmGxab -->

# Shape <!-- id:0stCYc3t -->

A **closed struct** with these fields: <!-- id:Y_Txjo0B -->
  - `anyOf` _(required)_ — list of [schema](./hypermedia-schema.md) <!-- id:aPkIeirH -->
  - `name` — `string` <!-- id:zfJVsmkn -->
  - `description` — `string` <!-- id:Mfcuk4fO -->
  - `params` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:WIZIEvso -->

# Depends on <!-- id:KU0BDVHI -->

- [schema](./hypermedia-schema.md) <!-- id:XRX69ozh -->
