---
name: Value
summary: "A metadata or attribute value: a string, an integer, a boolean, or null."
---
A **value** is one simple thing that a [document](./protocol/documents.md) attribute can hold: a string, an integer, a boolean, or `null`. For example, `"Smith"`, `42` and `true` are values. A list or a map is not. <!-- id:nVzS67ZR -->

To nest attributes, you do not put a map in a value. You write a key path instead. See [key-value](./key-value.md). The [SDK](./build/sdk.md) and the [CLI](./build/cli.md) can also store a list or a whole map under one key. That is outside this type, and [metadata](./metadata.md) says when to use it.

Value is also the type of the `value` of a [literal](./schema/literal-schema.md) schema. So only these four [kinds](./schema/kind.md) can be literals.

# See also <!-- id:h1JvtRp1 -->

- [metadata](./metadata.md): the attributes a document carries. <!-- id:tOVf_rPR -->
- [key-value](./key-value.md): one attribute assignment. <!-- id:fGjElCvD -->
- [SetAttributes](./change/op/set-attributes.md): the op that writes values. <!-- id:sQjYh4s3 -->
- [any](./any.md): the union of every value. <!-- id:0odp9V71 -->
- [Catalogue of types](./schema/types.md): every type in the library.
