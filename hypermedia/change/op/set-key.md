---
name: SetKey Op
summary: The deprecated flat form of SetAttributes that sets a single top-level metadata key, still accepted so old Changes replay.
---
**SetKey** is a deprecated [metadata](../../metadata.md) operation of a [document](../../protocol/documents.md): it sets one top-level key to one simple value. [SetAttributes](./set-attributes.md) replaces it, because SetAttributes can reach nested keys and set many keys in one operation. Changes that use SetKey exist on the network and must always replay. So the [daemon](../../software/daemon.md) applies SetKey as a SetAttributes with a path of one part. <!-- id:dUsTY6sm -->

This page defines the **change/op/set-key** operation, kept for compatibility inside a [Change body](../body.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:FCBip3cB -->

Do not write SetKey in new Changes. The [SDK](../../build/sdk.md) and the [Seed app](../../software/desktop.md) never write it. `value` is a string, a boolean, an integer or null. As with SetAttributes, the newest write by op id wins. <!-- id:cDYPBzAu -->

# See also <!-- id:cJTUpcBK -->

- [SetAttributes](./set-attributes.md): the op to use instead. <!-- id:OYI15l5u -->
- [metadata](../../metadata.md): the keys a document carries. <!-- id:RI8kflF_ -->
- [value](../../value.md): what a key can hold. <!-- id:fLAupoCD -->
- [change/op](../op.md): all operations. <!-- id:2GaxiZxv -->
