---
name: SetKey Op
summary: "Deprecated: set a single flat metadata key to a value."
schemaDefinition: ipfs://bafyreihl3tsfpri4hahwsok4dbcb5qwvhwi2akqmehpjtyzx2ncidmxn54
---
This document describes the **change/op/set-key** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:FCBip3cB -->

# Shape <!-- id:bpJR-BNN -->

A **closed struct** with these fields: <!-- id:V7WX1yMd -->
  - `type` _(required)_ — `"SetKey"` <!-- id:P7fT8krq -->
  - `key` — [string](../../string.md) <!-- id:WmbuE6qh -->
  - `value` — [value](../../value.md) <!-- id:4tkeslz0 -->

# Depends on <!-- id:_E_R0ssw -->

- [value](../../value.md) <!-- id:qm09nK_o -->
- [string](../../string.md) <!-- id:O0_PIyLu -->
