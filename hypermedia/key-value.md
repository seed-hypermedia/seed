---
name: Key/Value
summary: "One attribute assignment in a SetAttributes op: a key path (a list of segments) and a scalar value."
---
A **key/value** sets one attribute of a [document](./protocol/documents.md): a key and the value to store under it. The payload of a [SetAttributes](./change/op/set-attributes.md) op is a list of them. <!-- id:Z9zaDibn -->

- `key` is a path: a list of segments. So `["theme", "headerLayout"]` sets a nested key.
- `value` is a simple [value](./value.md): a string, an integer, a boolean or `null`. `null` deletes the key. The [SDK](./build/sdk.md) and the [CLI](./build/cli.md) can also write a list or a whole map as one value; see [metadata](./metadata.md).

The [daemon](./software/daemon.md) merges each path on its own, and the latest write to a path wins. A write to a path also removes any value stored at a path above it or below it. So one key never holds both a map and a nested key. See [metadata](./metadata.md).

This page defines the **key-value** type. The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type.

# See also <!-- id:xgcAtqwP -->

- [SetAttributes](./change/op/set-attributes.md): the op that carries these pairs. <!-- id:YR-_v9GQ -->
- [metadata](./metadata.md): the keys a document carries. <!-- id:tuYVDsB9 -->
- [value](./value.md): what a key can hold. <!-- id:qdc0XiUi -->
- [Documents](./protocol/documents.md): how registers merge. <!-- id:rLLaiZi9 -->
- [Catalogue of types](./schema/types.md): every type in the library.
