---
name: Any
summary: "The top type — matches any Hypermedia value: null, boolean, number, string, bytes, link, or a (recursively any) list or map. Use it for open, forward-compatible data."
schemaDefinition: ipfs://bafyreibpjj4gpwndtgzy4wxrv4jpbh3yngqoocmmdpb63deg4rbegzltea
---
This document describes the **any** type — a primitive. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:oO6eJaVw -->

# Shape <!-- id:B6ckZa1m -->

A **union** — a value matches one of these variants: <!-- id:6EezA2oG -->
  - [null](./null.md) <!-- id:cWQtIR13 -->
  - [boolean](./boolean.md) <!-- id:8wkCTWj0 -->
  - [integer](./integer.md) <!-- id:yhTYx7Wv -->
  - [float](./float.md) <!-- id:q_ivdjoq -->
  - [string](./string.md) <!-- id:iXK9KfV0 -->
  - [bytes](./bytes.md) <!-- id:oowqeiVG -->
  - [link](./link.md) <!-- id:5jlyKmWE -->
  - list of [any](./any.md) <!-- id:HOSZE8Y1 -->
  - map ⟨ \* : [any](./any.md) ⟩ <!-- id:zhX2rUxo -->

# Depends on <!-- id:J36yzGwM -->

- [boolean](./boolean.md) <!-- id:GtOFz5XG -->
- [bytes](./bytes.md) <!-- id:KPaOP9M- -->
- [float](./float.md) <!-- id:ORak9602 -->
- [integer](./integer.md) <!-- id:8pn0Cxu_ -->
- [link](./link.md) <!-- id:w35p-zQq -->
- [null](./null.md) <!-- id:3eQVhAK1 -->
- [string](./string.md) <!-- id:Wgktcf4G -->
