---
name: SetAttributes Op
summary: The operation that sets document metadata by key path, where each path is a last-writer-wins register and a nested write prunes older values above and below it.
schemaDefinition: ipfs://bafyreibr6hbizfakmkxx47wiqdzsstth3o2aa2iqzuoz5qp4ez3mczn2da
---
**SetAttributes** is how a [Change](../../change.md) edits a document's [metadata](../../metadata.md): the name, summary, icon, site URL, schema bindings and any custom attribute a schema defines. It lists key paths and values, and the daemon stores each one as a register where the newest write wins. <!-- id:cjx45B9D -->

This page defines the **change/op/set-attributes** operation inside a [Change body](../body.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:pyCYTEeq -->

`attrs` is a list of [key-value](../../key-value.md) pairs. The `key` is a path (`["name"]`, `["theme", "accent"]`) and the `value` is a string, boolean, integer up to 2^53−1, or null to delete. Writes resolve last-writer-wins by op id, and structurally. Setting `["a","b"]` removes an older value at `["a"]` or at `["a","b","c"]`, while an existing newer ancestor or descendant makes the incoming write a no-op, so a map value and a nested key never coexist. `block` is reserved for per-block attributes and must be empty today. A Change that sets it fails at replay. Block attributes are written inside [ReplaceBlock](./replace-block.md). When the daemon prepares a Change for the Seed app it emits one SetAttributes with every dirty attribute; see [Documents](../../protocol/documents.md). <!-- id:AWTro7zn -->

# Shape <!-- id:LAfbycov -->

A **closed struct** with these fields: <!-- id:t_VD1Nku -->
  - `type` _(required)_: `"SetAttributes"` <!-- id:8RrVMKzp -->
  - `block`: [string](../../string.md) <!-- id:DNLUlw3V -->
  - `attrs`: list of [key-value](../../key-value.md) <!-- id:fYFXgIHc -->

# Depends on <!-- id:LkWlsBr_ -->

- [key-value](../../key-value.md) <!-- id:XnogVOLT -->
- [string](../../string.md) <!-- id:wW3E9OCx -->

# See also <!-- id:2msgeUhu -->

- [metadata](../../metadata.md): the keys this op writes. <!-- id:AMNd63W1 -->
- [key-value](../../key-value.md): one key path and value. <!-- id:VePy3P20 -->
- [SetKey](./set-key.md): the deprecated flat form. <!-- id:-U407d6U -->
- [Typed documents](../../schema/typed-documents.md): custom attributes from a schema. <!-- id:5RhWlQtH -->
- [change/op](../op.md): all operations. <!-- id:vvoWGmkv -->
