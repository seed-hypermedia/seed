---
name: None
summary: The bottom type, which accepts no values and is defined as an empty union.
---
The **none** type accepts no value at all. Its schema is `{"anyOf": []}`: a [union](./schema/anyof.md) with no arms, so there is nothing a value can match. Refer to it as `{"type": "hm://hyper.media/none"}`. It is a schema built from the union vocabulary, and it is not a new [kind](./schema/kind.md) of data. <!-- id:i1IGjzE- -->

Two other types are easy to confuse with none. The [null](./null.md) type and the bare literal schema `null` accept exactly one value: `null`. The [any](./any.md) type accepts every Hypermedia value. <!-- id:7GQol9Iu -->

What none does inside another schema: <!-- id:KyHcjRq9 -->

- A [list](./list.md) whose `items` schema is none can only be empty.
- A [map](./map.md) whose `values` schema is none can only be empty.
- On a [struct](./struct.md), `values` applies to extra fields. Setting it to none forbids fields outside `properties`.
- An optional field of type none must be absent.
- A required field of type none makes the struct impossible to satisfy.

The generated TypeScript type is `HMNone = never`. The type has no default value for editors to create. The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). <!-- id:W0TpDrCU -->

# See also <!-- id:2ecP_G1Y -->

- [Union schema](./schema/anyof.md): a value must match at least one alternative. <!-- id:qeRTFpYc -->
- [Null](./null.md): the type with exactly one value. <!-- id:kdTi0uv8 -->
- [Any](./any.md): the type that accepts every value. <!-- id:g7czSn-4 -->
- [Catalogue of types](./schema/types.md): every type in the library.
