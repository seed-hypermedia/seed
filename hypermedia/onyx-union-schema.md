---
name: Union schema
summary: The variant for a union — a value matching any one of several alternatives (anyOf).
schemaDefinition: ipfs://bafyreie7xnwnhehhqqsfrwdivesji4sdaig2lq4xcvfvnxtlwayxxp2nrq
---
This document describes the **onyx-union-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:C3PmGxab -->

# Shape <!-- id:0stCYc3t -->

A **closed struct** with these fields: <!-- id:Y_Txjo0B -->
  - `anyOf` _(required)_ — list of [schema](./onyx-schema.md) <!-- id:aPkIeirH -->
  - `name` — `string` <!-- id:zfJVsmkn -->
  - `description` — `string` <!-- id:Mfcuk4fO -->
  - `params` — map ⟨ \* : [schema](./onyx-schema.md) ⟩ <!-- id:WIZIEvso -->

# Depends on <!-- id:KU0BDVHI -->

- [schema](./onyx-schema.md) <!-- id:XRX69ozh -->
