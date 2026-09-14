---
name: Value
summary: "A metadata / attribute value: string, integer, boolean, or null."
schemaDefinition: ipfs://bafyreiejjdkvxutyey6sz5trwhwrnjxcuvkxky7rxnuhmeishf64hqduk4
---
This document describes the **schema/value** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. It is also the type of a [literal](./literal-schema.md) schema's `value`: only these four kinds can be literals. <!-- id:8zx2Wxx- -->

# Shape <!-- id:-_VwZsPA -->

A **union** — a value matches one of these variants: <!-- id:FP14r8De -->
  - [string](./string.md) <!-- id:q_-3ZaLh -->
  - [integer](./integer.md) <!-- id:IdkeOjM8 -->
  - [boolean](./boolean.md) <!-- id:t0GZMYM_ -->
  - [null](./null.md) <!-- id:k5elhASZ -->

# Depends on <!-- id:7ToAc9Am -->

- [boolean](./boolean.md) <!-- id:S2OmrZel -->
- [integer](./integer.md) <!-- id:to5AEXO- -->
- [null](./null.md) <!-- id:0H0AVvuc -->
- [string](./string.md) <!-- id:pkVoFHW4 -->
