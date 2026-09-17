---
name: SetKey Op
summary: The deprecated flat form of SetAttributes that sets a single top-level metadata key, still accepted so old Changes replay.
schemaDefinition: ipfs://bafyreihl3tsfpri4hahwsok4dbcb5qwvhwi2akqmehpjtyzx2ncidmxn54
---
SetKey is the original metadata operation: one top-level key, one scalar value. It was superseded by [SetAttributes](./set-attributes.md), which addresses nested key paths and sets many keys in one op, but Changes that used SetKey exist on the network and must replay forever, so the daemon still applies it as a SetAttributes with a single-segment path. <!-- id:dUsTY6sm -->

This page defines the **change/op/set-key** operation, kept for compatibility inside a [Change body](../body.md). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:FCBip3cB -->

Do not emit SetKey in new Changes; the SDK and the Seed app no longer do. `value` is a string, boolean, integer or null, with the same last-writer-wins semantics by op id as SetAttributes. <!-- id:cDYPBzAu -->

# Shape <!-- id:bpJR-BNN -->

A **closed struct** with these fields: <!-- id:V7WX1yMd -->
  - `type` _(required)_: `"SetKey"` <!-- id:P7fT8krq -->
  - `key`: [string](../../string.md) <!-- id:WmbuE6qh -->
  - `value`: [value](../../value.md) <!-- id:4tkeslz0 -->

# Depends on <!-- id:_E_R0ssw -->

- [value](../../value.md) <!-- id:qm09nK_o -->
- [string](../../string.md) <!-- id:O0_PIyLu -->
