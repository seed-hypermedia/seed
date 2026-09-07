---
name: Value
summary: "A metadata / attribute value: string, integer, boolean, or null."
schemaDefinition: ipfs://bafyreigihbrqocdwo5tvwwtz5sa5syz6zgcmxvegd3xdtlfhxh7ucab24m
---
This document describes the **hypermedia-value** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:8zx2Wxx- -->

# Shape <!-- id:-_VwZsPA -->

A **union** — a value matches one of these variants: <!-- id:FP14r8De -->
  - [string](./hypermedia-string.md) <!-- id:q_-3ZaLh -->
  - [integer](./hypermedia-integer.md) <!-- id:IdkeOjM8 -->
  - [boolean](./hypermedia-boolean.md) <!-- id:t0GZMYM_ -->
  - [null](./hypermedia-null.md) <!-- id:k5elhASZ -->

# Depends on <!-- id:7ToAc9Am -->

- [boolean](./hypermedia-boolean.md) <!-- id:S2OmrZel -->
- [integer](./hypermedia-integer.md) <!-- id:to5AEXO- -->
- [null](./hypermedia-null.md) <!-- id:0H0AVvuc -->
- [string](./hypermedia-string.md) <!-- id:pkVoFHW4 -->
