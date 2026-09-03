---
name: Paragraph block
summary: A paragraph of rich text with annotations.
schemaDefinition: ipfs://bafyreifj7jpmmn4qr6dbzotd5hql47i7yrner23nmwdymxc2lrkrvop3yi
---
This document describes the **hypermedia-block-paragraph** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Vou7cbhc -->

# Shape <!-- id:l0o5Tte_ -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:a3oACyxn -->
  - `type` — `string` enum: `Paragraph` <!-- id:tHz4ynCQ -->
  - `text` — [string](./onyx-string.md) <!-- id:_0H0S0T5 -->
  - `annotations` — list of [hypermedia-annotation](./hypermedia-annotation.md) <!-- id:pXxDvrgh -->
  - `attributes` — map { 3 fields } <!-- id:ohl09HNZ -->

# Depends on <!-- id:yL-NVw3Z -->

- [hypermedia-annotation](./hypermedia-annotation.md) <!-- id:T-dO1QZb -->
- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:-NxYvbtm -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:YV6PY--I -->
- [any](./onyx-any.md) <!-- id:Kyh6AeJj -->
- [float](./onyx-float.md) <!-- id:MOYG_rHe -->
- [string](./onyx-string.md) <!-- id:Pf_eLNrP -->
