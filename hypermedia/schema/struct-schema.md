---
name: Struct schema
summary: The variant for a struct, with known fields under properties and optionally extra keys of one type under values.
schemaDefinition: ipfs://bafyreigaaaz4ycvw2opvffvdnu6jnpc7ik5xka5erx3hkfucu5yikxk3ce
---
This is the shape a schema takes when it describes a struct. `type` is `struct`. `properties` names the fields, with one [property](./property.md) per field. Each property carries its value schema, whether a value must include it, and a description. An optional `values` opens the struct to further keys of one type. Like every [variant](./variant.md), a struct schema is a closed struct itself, so a stray keyword is rejected. <!-- id:xBr-gnCA -->

# See also <!-- id:x77oiiNm -->

- [Property](./property.md): one field of a struct. <!-- id:zp8RPAUe -->
- [Closed map](./closed-map.md): what happens to keys a struct does not name. <!-- id:9DGI7PNd -->
- [Map schema](./map-schema.md): arbitrary keys with one value type. <!-- id:x9pjzrgk -->
- [Extension](./extension.md): a struct that builds on a parent. <!-- id:AutXIIgU -->
- [Typed documents](./typed-documents.md): how a document names the schema of its attributes. <!-- id:soCY_jUh -->
