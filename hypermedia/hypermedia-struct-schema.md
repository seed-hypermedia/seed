---
name: Struct schema
summary: The variant for a struct — known fields via properties and required, optionally open to extra keys via values.
schemaDefinition: ipfs://bafyreignl7snikl4ptvqmm2ptnzhkzwz5jeztjjqnovkf6new6tmous3mq
---
The shape a schema takes when it describes a struct: `type` is `struct`, `properties` names the fields and their schemas, `required` lists the ones a value must include, and an optional `values` opens the struct to further keys of one type. Like every variant it is a closed struct itself, so a stray keyword is rejected. <!-- id:xBr-gnCA -->
