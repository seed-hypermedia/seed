---
name: SetKey op
summary: "Deprecated: set a single flat metadata key to a value."
schemaDefinition: ipfs://bafyreiaygo7ngxmddjhq2tqld5esjuzjzqjzvwbqda33rr3gyakmqxi644
---
This document describes the **hypermedia-op-set-key** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:FCBip3cB -->

# Shape <!-- id:bpJR-BNN -->

A **closed struct** with these fields: <!-- id:V7WX1yMd -->
  - `type` _(required)_ — `string` enum: `SetKey` <!-- id:P7fT8krq -->
  - `key` — [string](./onyx-string.md) <!-- id:WmbuE6qh -->
  - `value` — [hypermedia-value](./hypermedia-value.md) <!-- id:4tkeslz0 -->

# Depends on <!-- id:_E_R0ssw -->

- [hypermedia-value](./hypermedia-value.md) <!-- id:qm09nK_o -->
- [string](./onyx-string.md) <!-- id:O0_PIyLu -->
