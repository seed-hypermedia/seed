---
name: Struct
summary: A map with known, named fields, the type behind every record-like value from an address to a signed Change.
schemaDefinition: ipfs://bafyreieff2wkyfnyxymypvvvy4fa6kxeulvgktdzvfqnqy2wsjtel7yioq
---
A **struct** is the kind for named fields. `properties` fixes each field. The struct is closed, so unlisted keys are rejected, unless it adds a `values` tail. A [map](./map.md) has no named fields: every value matches one `values` schema. <!-- id:Nsw83C4N -->

A struct is a map whose keys are known in advance. Its [struct schema](./schema/struct-schema.md) lists them under `properties`, one [property](./schema/property.md) per field: the field's value schema, whether it is required, and a description. It is **closed** unless it also gives `values`, the schema every extra key must satisfy. In the [data model](./schema/data-model.md) a struct is still a map. The difference lives in the schema: a form knows which fields to show, a validator knows which keys are stray, and a generated type gets named members. <!-- id:J20ZwIOY -->

Use a struct when the fields have names and meanings of their own: a person has a `name` and an `age`, and a [Change](./change.md) has a `genesis` and `deps`. Use a map when the keys are data, such as word to count or key to value. The reference examples are [Example: Person](./example/person.md) for a struct and [Example: Counts](./example/counts.md) for a map. <!-- id:F1E6Hqx9 -->

# See also

- [map](./map.md): keys that are data.
- [Struct schema](./schema/struct-schema.md): the schema form of a struct.
- [property](./schema/property.md): one field of a struct.
- [Closed map](./schema/closed-map.md): what closed means.
- [Data model](./schema/data-model.md): all the kinds.
