---
name: Struct schema
summary: The variant for a struct — known fields via properties, optionally open to extra keys via values.
schemaDefinition: ipfs://bafyreigaaaz4ycvw2opvffvdnu6jnpc7ik5xka5erx3hkfucu5yikxk3ce
---
The shape a schema takes when it describes a struct: `type` is `struct`, `properties` names the fields — one [property](./property.md) per field, carrying its value schema, whether a value must include it, and a description — and an optional `values` opens the struct to further keys of one type. Like every variant it is a closed struct itself, so a stray keyword is rejected. <!-- id:xBr-gnCA -->
