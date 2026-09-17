---
name: Value
summary: "A metadata or attribute value: a string, an integer, a boolean, or null."
schemaDefinition: ipfs://bafyreieg4ddcrqezij6pymoqtm7tex6i3c6nsl7qkhmj5trfboz534k4qi
---
A **value** is a scalar a document attribute can hold: a string, an integer, a boolean, or `null`. Nested attributes are written as key paths, not as map values; see [key-value](./key-value.md). It is also the type of a [literal](./schema/literal-schema.md) schema's `value`, so only these four kinds can be literals.

# Shape <!-- id:-_VwZsPA -->

A **union**. A value matches one of these variants: <!-- id:FP14r8De -->
  - [string](./string.md) <!-- id:q_-3ZaLh -->
  - [integer](./integer.md) <!-- id:IdkeOjM8 -->
  - [boolean](./boolean.md) <!-- id:t0GZMYM_ -->
  - [null](./null.md) <!-- id:k5elhASZ -->

# Depends on <!-- id:7ToAc9Am -->

- [boolean](./boolean.md) <!-- id:S2OmrZel -->
- [integer](./integer.md) <!-- id:to5AEXO- -->
- [null](./null.md) <!-- id:0H0AVvuc -->
- [string](./string.md) <!-- id:pkVoFHW4 -->

# See also

- [metadata](./metadata.md): the attributes a document carries.
- [key-value](./key-value.md): one attribute assignment.
- [SetAttributes](./change/op/set-attributes.md): the op that writes values.
- [any](./any.md): the union of every value.
