---
name: Any
summary: "The top type — matches any Onyx value: null, boolean, number, string, bytes, link, or a (recursively any) list or map. Use it for open, forward-compatible data."
schemaDefinition: ipfs://bafyreicu4jdadzujhlb3qxit6mpqois6dcxiacjseoywm5jwwk3lhwz2le
---
This document describes the **hypermedia-any** type — a primitive. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:oO6eJaVw -->

# Shape <!-- id:B6ckZa1m -->

A **union** — a value matches one of these variants: <!-- id:6EezA2oG -->
  - [null](./hypermedia-null.md) <!-- id:cWQtIR13 -->
  - [boolean](./hypermedia-boolean.md) <!-- id:8wkCTWj0 -->
  - [integer](./hypermedia-integer.md) <!-- id:yhTYx7Wv -->
  - [float](./hypermedia-float.md) <!-- id:q_ivdjoq -->
  - [string](./hypermedia-string.md) <!-- id:iXK9KfV0 -->
  - [bytes](./hypermedia-bytes.md) <!-- id:oowqeiVG -->
  - [link](./hypermedia-link.md) <!-- id:5jlyKmWE -->
  - list of [any](./hypermedia-any.md) <!-- id:HOSZE8Y1 -->
  - map ⟨ \* : [any](./hypermedia-any.md) ⟩ <!-- id:zhX2rUxo -->

# Depends on <!-- id:J36yzGwM -->

- [boolean](./hypermedia-boolean.md) <!-- id:GtOFz5XG -->
- [bytes](./hypermedia-bytes.md) <!-- id:KPaOP9M- -->
- [float](./hypermedia-float.md) <!-- id:ORak9602 -->
- [integer](./hypermedia-integer.md) <!-- id:8pn0Cxu_ -->
- [link](./hypermedia-link.md) <!-- id:w35p-zQq -->
- [null](./hypermedia-null.md) <!-- id:3eQVhAK1 -->
- [string](./hypermedia-string.md) <!-- id:Wgktcf4G -->
