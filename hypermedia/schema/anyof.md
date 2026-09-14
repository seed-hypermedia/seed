---
name: Union schema
summary: The variant for a union — a value matching any one of several alternatives (anyOf).
schemaDefinition: ipfs://bafyreiavy3xzdtxbb4auh67wqqeuxw4ez4qxofk2g65iux7s75yzdyqkga
---
**`anyOf`** — the union keyword: a list of schemas; a value is valid if it matches any of them. the schema language's one composite construct. A union whose arms are all literals is a fixed set of choices (`{anyOf: ["draft", "published"]}`), which the editors show as a dropdown. <!-- id:ppR9ujjo -->

This document describes the **schema/anyof** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:C3PmGxab -->

A union lists alternative schemas under `anyOf`; a value is valid if it matches any of them. When every arm is a [literal](./literal-schema.md), the union is a fixed set of choices — `{"anyOf": ["draft", "published", "archived"]}` — which the editors offer as a dropdown. <!-- id:_g0zYO8Q -->

# Shape <!-- id:0stCYc3t -->

A **closed struct** with these fields: <!-- id:Y_Txjo0B -->
  - `anyOf` _(required)_ — list of [schema](../schema.md) <!-- id:aPkIeirH -->
  - `name` — `string` <!-- id:zfJVsmkn -->
  - `description` — `string` <!-- id:Mfcuk4fO -->
  - `params` — map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:WIZIEvso -->

# Depends on <!-- id:KU0BDVHI -->

- [schema](../schema.md) <!-- id:XRX69ozh -->
