---
name: Map
summary: "A map of string keys to values of one type (Map<Any> until `values` constrains it); use a struct when the field names are known."
schemaDefinition: ipfs://bafyreihx27axfprby465bchmgv7g4kwoyiclofqnja3ylemya53rm4vsty
---
The **map** type is a core type: a map whose keys are data, where each value matches the `values` schema. When the keys are known field names, use a [struct](./struct.md) instead. Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:kVoJpXNY -->

# Shape <!-- id:crlkBvsQ -->

Kind: `map`. <!-- id:-28QE2Pc -->

# See also

- [struct](./struct.md): a map with known, named fields.
- [Map schema](./schema/map-schema.md): how a schema constrains the values.
- [Example: Counts](./example/counts.md): a map in use.
- [Data model](./schema/data-model.md): all the kinds.
