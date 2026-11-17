---
name: Struct
summary: A map with known, named fields, the type behind every record-like value from an address to a signed Change.
---
A **struct** is a map whose keys are known in advance. For example, a person is a struct with the fields `name` and `age`. It is not a tenth [kind](./schema/kind.md): when stored, a struct is a [map](./map.md). <!-- id:Nsw83C4N -->

A [struct schema](./schema/struct-schema.md) lists the fields under `properties`, one [property](./schema/property.md) per field. Each property gives the schema of the field's value, whether the field is required, and a description. A struct is **closed**, so other keys are rejected, unless it also gives `values`. Then extra keys are allowed, and each extra value must match the `values` schema. <!-- id:J20ZwIOY -->

In the [data model](./schema/data-model.md) a struct is still a map. The difference is in the schema, and three things use it:

- A form knows which fields to show.
- A validator knows which keys do not belong.
- A generated type gets named members.

Use a struct when the fields have names and meanings of their own. A person has a `name` and an `age`. A [Change](./change.md) has a `genesis` and `deps`. Use a map when the keys are data, such as word to count. The reference examples are [Example: Person](./example/person.md) for a struct and [Example: Counts](./example/counts.md) for a map. <!-- id:F1E6Hqx9 -->

This page defines the **struct** type. The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type.

# See also <!-- id:VBczfrkP -->

- [map](./map.md): keys that are data. <!-- id:2rMJ3DRE -->
- [Struct schema](./schema/struct-schema.md): the schema form of a struct. <!-- id:vC_b3Xeo -->
- [property](./schema/property.md): one field of a struct. <!-- id:dIHHKN5o -->
- [Closed map](./schema/closed-map.md): what closed means. <!-- id:YbKVw2qm -->
- [Data model](./schema/data-model.md): all the kinds. <!-- id:4JMUSvl1 -->
- [Catalogue of types](./schema/types.md): every type in the library.
