---
name: Paragraph block
summary: A paragraph of rich text with annotations.
schemaDefinition: ipfs://bafyreic6atyk6x2tnsbg67vcih5srjy5audlc6izyizkzgyi2qt2kw7jcu
---
This document describes the **schema/block/paragraph** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Vou7cbhc -->

# Shape <!-- id:l0o5Tte_ -->

**Extends** [schema/block/base](./base.md) with these added fields: <!-- id:a3oACyxn -->
  - `type` — `"Paragraph"` <!-- id:tHz4ynCQ -->
  - `text` — [string](../string.md) <!-- id:_0H0S0T5 -->
  - `annotations` — list of [schema/block/annotation](./annotation.md) <!-- id:pXxDvrgh -->
  - `attributes` — map { 3 fields } <!-- id:ohl09HNZ -->

# Depends on <!-- id:yL-NVw3Z -->

- [schema/block/annotation](./annotation.md) <!-- id:T-dO1QZb -->
- [schema/block/base](./base.md) <!-- id:-NxYvbtm -->
- [schema/block/children-type](./children-type.md) <!-- id:YV6PY--I -->
- [any](../any.md) <!-- id:Kyh6AeJj -->
- [float](../float.md) <!-- id:MOYG_rHe -->
- [string](../string.md) <!-- id:Pf_eLNrP -->
