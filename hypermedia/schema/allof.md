---
name: Intersection schema
summary: The variant for an intersection, which accepts a value that satisfies every schema listed under allOf, by merging its struct arms into one.
---
**`allOf`**: the intersection keyword. It holds a list of [schemas](../schema.md), and a value is valid if it satisfies all of them. Where [`anyOf`](./anyof.md) says _or_, `allOf` says _and_. Each arm must be a [struct](./struct-schema.md) or [map](./map-schema.md), or [name](./include-schema.md) one, and the arms merge into a single struct: the union of their fields, a field required when any arm requires it, closed when any arm is [closed](./closed-map.md). An arm may be an inline struct, so `{allOf: [{type: A}, {type: B}, {type: struct, properties: {…}}]}` is A and B plus new fields.

This document describes the **schema/allof** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works.

The arms merge rather than each validating the value in turn, because structs are closed by default: a value cannot satisfy two closed field sets at once, so validating against each arm would accept nothing. Merging is what [extension](./extension.md) already does with its one parent; `allOf` does the same with several. A schema written with `allOf` is a subtype of every arm that names a schema, so a typed link to either parent accepts a document of the intersection.

Two arms that define the same field must define it the same way, and arms that constrain extra keys through `values` must agree. A schema that breaks either rule, or whose arm is not a struct, fails validation with the reason. An empty `allOf` is not a schema. The example is [staff-member](../example/staff-member.md), an [employee](../example/employee.md) who is also a [contact](../example/contact.md).

# See also

- [Union schema](./anyof.md): the other composite construct, _or_ to this one's _and_.
- [Extension](./extension.md): a subtype with one parent; `allOf` gives a subtype several.
- [Closed map](./closed-map.md): why the arms merge instead of each checking the value.
- [Variant](./variant.md): the members of the meta-schema union.
- [The schema language](./schema-language.md): the full vocabulary.
