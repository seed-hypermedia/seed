---
name: Primitive
summary: 'A primitive is the library''s ready-made schema for one kind, such as `string` or `boolean`, and it is exactly `{ "type": <kind> }`.'
---
A **primitive** is the library's ready-made schema for one [kind](./kind.md), such as [string](../string.md) or [boolean](../boolean.md). It is exactly `{ "type": <kind> }`. The library has one for each of the nine kinds, plus one for [struct](../struct.md). <!-- id:3HfWQq4T -->

When a field says `{ "type": "hm://…/string" }`, it names the kind and points at this schema at the same time. It uses the same `type` key that names any other schema.

Do not mix a primitive up with a [variant](./variant.md). A variant is a shape that a schema can take. A primitive is one finished schema: a value that matches the [meta-schema](../schema.md). [The data model](./data-model.md) lists the kinds.

# See also <!-- id:z2W239gM -->

- [Kind](./kind.md): the nine value types. <!-- id:0w-qvAzT -->
- [The data model](./data-model.md): what each kind holds. <!-- id:wNC0Kqjp -->
- [Scalar schema](./scalar-schema.md): a kind narrowed by constraints. <!-- id:r3aQwmKh -->
- [Include schema](./include-schema.md): how naming a schema with `type` works. <!-- id:DxOBszkm -->
- [The catalogue of types](./types.md): every primitive, with its page. <!-- id:iZnYnlTZ -->
