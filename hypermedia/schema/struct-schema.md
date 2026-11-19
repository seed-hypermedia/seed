---
name: Struct schema
summary: The variant for a struct, with known fields under properties and optionally extra keys of one type under values.
---
A struct schema describes a [struct](../struct.md): a map with named fields. Its `type` is `struct`. `properties` names the fields, with one [property](./property.md) per field. Each property carries the schema of its value, whether a value must include the field, and a description. <!-- id:xBr-gnCA -->

A struct is [closed](./closed-map.md): it rejects keys that `properties` does not list. An optional `values` opens the struct to more keys, and every extra value must match the `values` schema.

This page defines the **schema/struct-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. Like every variant, a struct schema is a closed struct itself, so a misspelled or unknown key is rejected.

# See also <!-- id:x77oiiNm -->

- [Property](./property.md): one field of a struct. <!-- id:zp8RPAUe -->
- [Closed map](./closed-map.md): what happens to keys a struct does not name. <!-- id:9DGI7PNd -->
- [Map schema](./map-schema.md): any keys, with one value type. <!-- id:x9pjzrgk -->
- [Extension](./extension.md): a struct that builds on a parent. <!-- id:AutXIIgU -->
- [Typed documents](./typed-documents.md): how a [document](../protocol/documents.md) names the schema of its attributes. <!-- id:soCY_jUh -->
