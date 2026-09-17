---
name: Struct
summary: A map with known, named fields — the type behind every record-like value, from an address to a signed Change.
schemaDefinition: ipfs://bafyreieff2wkyfnyxymypvvvy4fa6kxeulvgktdzvfqnqy2wsjtel7yioq
---
**Struct**: the kind for named fields: `properties` fixes each field, and the struct is closed (unlisted keys rejected) unless it adds a `values` tail. A `map` has no named fields — every value matches one `values` schema. <!-- id:Nsw83C4N -->

A struct is a map whose keys are known in advance. Its schema lists them under `properties`, one [property](./schema/property.md) per field — the field's value schema, whether it is required, and a description — and is **closed** unless it also gives `values`, the schema every extra key must satisfy. At the data-model level a struct is still a map; the distinction lives in the schema, where it does the work: a form knows which fields to show, a validator knows which keys are stray, a generated type gets named members. <!-- id:J20ZwIOY -->

Use a struct when the fields have names and meanings of their own: a person has a `name` and an `age`, a Change has a `genesis` and `deps`. Use a [map](./map.md) when the keys are data: word → count, key → value. The reference examples are [Example: Person](./example/person.md) for a struct and [Example: Counts](./example/counts.md) for a map. <!-- id:F1E6Hqx9 -->
