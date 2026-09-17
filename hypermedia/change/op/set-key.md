---
name: SetKey Op
summary: The deprecated flat form of SetAttributes that sets a single top-level metadata key, still accepted so old Changes replay.
---
**SetKey** is the original [metadata](../../metadata.md) operation: one top-level key, one scalar value. [SetAttributes](./set-attributes.md) replaced it, because it addresses nested key paths and sets many keys in one op. Changes that used SetKey exist on the network and must replay forever, so the daemon still applies SetKey as a SetAttributes with a single-segment path. <!-- id:dUsTY6sm -->

This page defines the **change/op/set-key** operation, kept for compatibility inside a [Change body](../body.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:FCBip3cB -->

Do not emit SetKey in new Changes. The SDK and the Seed app no longer do. `value` is a string, boolean, integer or null, with the same last-writer-wins semantics by op id as SetAttributes. <!-- id:cDYPBzAu -->

# See also <!-- id:cJTUpcBK -->

- [SetAttributes](./set-attributes.md): the op to use instead. <!-- id:OYI15l5u -->
- [metadata](../../metadata.md): the keys a document carries. <!-- id:RI8kflF_ -->
- [value](../../value.md): what a key can hold. <!-- id:fLAupoCD -->
- [change/op](../op.md): all operations. <!-- id:2GaxiZxv -->
