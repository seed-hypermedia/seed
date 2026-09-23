---
name: Value
summary: "A metadata or attribute value: a string, an integer, a boolean, or null."
---
A **value** is a scalar a document attribute can hold: a string, an integer, a boolean, or `null`. Nested attributes are written as key paths, not as map values; see [key-value](./key-value.md). It is also the type of a [literal](./schema/literal-schema.md) schema's `value`, so only these four kinds can be literals. <!-- id:nVzS67ZR -->

# See also <!-- id:h1JvtRp1 -->

- [metadata](./metadata.md): the attributes a document carries. <!-- id:tOVf_rPR -->
- [key-value](./key-value.md): one attribute assignment. <!-- id:fGjElCvD -->
- [SetAttributes](./change/op/set-attributes.md): the op that writes values. <!-- id:sQjYh4s3 -->
- [any](./any.md): the union of every value. <!-- id:0odp9V71 -->
