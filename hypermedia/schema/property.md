---
name: Property
summary: One field of a struct, holding its value schema, whether a value must include it, and a description of what it is for.
schemaDefinition: ipfs://bafyreiddimhjlsf7ba6idhzdt6h5bgna77merrs5msg4vscsauuc362u3q
---
A [struct](./struct-schema.md) lists its fields under `properties`, one property per field name. A property wraps a [schema](../schema.md) and is not a schema itself. `value` is the schema the field's value must match. `required` says whether a value of the struct must include the field. `description` says what the field is for, and the editors show it next to the field. <!-- id:kLdsYe2_ -->

# See also <!-- id:QjhOSVQr -->

- [Struct schema](./struct-schema.md): the variant that holds properties. <!-- id:XM4Yuuo- -->
- [Closed map](./closed-map.md): a struct rejects keys it has no property for. <!-- id:cIxFafFB -->
- [Extension](./extension.md): adds properties to a parent schema. <!-- id:9mvkwJHp -->
- [Typed documents](./typed-documents.md): how the editors turn properties into fields. <!-- id:UXu7sHvc -->
