---
name: Key/Value
summary: "A metadata attribute: a dotted key path (segments) and a value."
schemaDefinition: ipfs://bafyreid3pt5qld4kqjqs2z5gnnqjbovrh65cny6v2y7bdbsyqulwcgesfq
---
This document describes the **key-value** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:KBi_5PW1 -->

# Shape <!-- id:VMONYTkt -->

A **closed struct** with these fields: <!-- id:NyettGx4 -->
  - `key` — list of [string](./string.md) <!-- id:STJDSKAR -->
  - `value` — [value](./value.md) <!-- id:7qky9GU7 -->

# Depends on <!-- id:vLWqKSnN -->

- [value](./value.md) <!-- id:yrWGRztM -->
- [string](./string.md) <!-- id:v5aghFcs -->
