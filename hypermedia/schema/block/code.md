---
name: Code block
summary: A code block, optionally tagged with a language.
schemaDefinition: ipfs://bafyreibcuhrfcbvzeuw7h5caniw5eumfl6pobr6qdcemc4k4vlklpmv52i
---
This document describes the **schema/block/code** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:fqG3-TI_ -->

# Shape <!-- id:Wlv2TURN -->

**Extends** [schema/block/base](./base.md) with these added fields: <!-- id:M3xZk6r7 -->
  - `type` — `"Code"` <!-- id:F_X9vLc- -->
  - `text` — [string](../string.md) <!-- id:1CNgUNEp -->
  - `attributes` — map { 3 fields } <!-- id:IzYor5cE -->

# Depends on <!-- id:1PZKCBGr -->

- [schema/block/base](./base.md) <!-- id:UPJREQHL -->
- [schema/block/children-type](./children-type.md) <!-- id:lrSmJj0P -->
- [any](../any.md) <!-- id:FPY-Yu6f -->
- [float](../float.md) <!-- id:dPDYHZ7F -->
- [string](../string.md) <!-- id:ui04XeY6 -->
