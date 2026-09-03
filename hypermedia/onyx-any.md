---
name: Any
summary: "The top type — matches any Onyx value: null, boolean, number, string, bytes, link, or a (recursively any) list or map. Use it for open, forward-compatible data."
schemaDefinition: ipfs://bafyreia5kfqzd4ssw2w23rqvglbau7zbn72hprhneswojii5zdah3mhy4q
---
This document describes the **onyx-any** type — a primitive. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:oO6eJaVw -->

# Shape <!-- id:B6ckZa1m -->

A **union** — a value matches one of these variants: <!-- id:6EezA2oG -->
  - [null](./onyx-null.md) <!-- id:cWQtIR13 -->
  - [boolean](./onyx-boolean.md) <!-- id:8wkCTWj0 -->
  - [integer](./onyx-integer.md) <!-- id:yhTYx7Wv -->
  - [float](./onyx-float.md) <!-- id:q_ivdjoq -->
  - [string](./onyx-string.md) <!-- id:iXK9KfV0 -->
  - [bytes](./onyx-bytes.md) <!-- id:oowqeiVG -->
  - [link](./onyx-link.md) <!-- id:5jlyKmWE -->
  - list of [any](./onyx-any.md) <!-- id:HOSZE8Y1 -->
  - map ⟨ \* : [any](./onyx-any.md) ⟩ <!-- id:zhX2rUxo -->

# Depends on <!-- id:J36yzGwM -->

- [boolean](./onyx-boolean.md) <!-- id:GtOFz5XG -->
- [bytes](./onyx-bytes.md) <!-- id:KPaOP9M- -->
- [float](./onyx-float.md) <!-- id:ORak9602 -->
- [integer](./onyx-integer.md) <!-- id:8pn0Cxu_ -->
- [link](./onyx-link.md) <!-- id:w35p-zQq -->
- [null](./onyx-null.md) <!-- id:3eQVhAK1 -->
- [string](./onyx-string.md) <!-- id:Wgktcf4G -->
