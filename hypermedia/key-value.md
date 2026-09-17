---
name: Key/Value
summary: "One attribute assignment in a SetAttributes op: a key path (a list of segments) and a scalar value."
schemaDefinition: ipfs://bafyreifgtew4cyin4lry5idl7igtl32eibtmakoumyrl3alsqevpsf3gi4
---
A **key/value** is one attribute assignment. The payload of a [SetAttributes](./change/op/set-attributes.md) op is a list of them. `key` is a path of segments, so `["theme", "headerLayout"]` sets a nested key. `value` is a scalar [value](./value.md), and `null` deletes the key. The daemon merges each path last-writer-wins. A write to a path also removes any register at an ancestor or descendant path, so a map and a nested key never coexist. See [metadata](./metadata.md). <!-- id:Z9zaDibn -->

# Shape <!-- id:VMONYTkt -->

A **closed struct** with these fields: <!-- id:NyettGx4 -->
  - `key`: list of [string](./string.md) <!-- id:STJDSKAR -->
  - `value`: [value](./value.md) <!-- id:7qky9GU7 -->

# Depends on <!-- id:vLWqKSnN -->

- [value](./value.md) <!-- id:yrWGRztM -->
- [string](./string.md) <!-- id:v5aghFcs -->

# See also <!-- id:xgcAtqwP -->

- [SetAttributes](./change/op/set-attributes.md): the op that carries these pairs. <!-- id:YR-_v9GQ -->
- [metadata](./metadata.md): the keys a document carries. <!-- id:tuYVDsB9 -->
- [value](./value.md): what a key can hold. <!-- id:qdc0XiUi -->
- [Documents](./protocol/documents.md): how registers merge. <!-- id:rLLaiZi9 -->
