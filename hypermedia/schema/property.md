---
name: Property
summary: One field of a struct, holding its value schema, whether a value must include it, and a description of what it is for.
---
A **property** is one field of a [struct](../struct.md). A [struct schema](./struct-schema.md) lists its fields under `properties`, one property per field name. A property wraps a [schema](../schema.md) and is not a schema itself. <!-- id:kLdsYe2_ -->

A property has three keys:

- `value` is the schema that the field's value must match.
- `required` says whether a value of the struct must include the field.
- `description` says what the field is for. The editors show it next to the field.

For example, `"surname": {"value": {"type": "hm://hyper.media/string"}, "required": true}` is a required text field called `surname`.

This page defines the **schema/property** type. The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md).

# See also <!-- id:QjhOSVQr -->

- [Struct schema](./struct-schema.md): the variant that holds properties. <!-- id:XM4Yuuo- -->
- [Closed map](./closed-map.md): a struct rejects keys it has no property for. <!-- id:cIxFafFB -->
- [Extension](./extension.md): adds properties to a parent schema. <!-- id:9mvkwJHp -->
- [Typed documents](./typed-documents.md): how the editors turn properties into fields. <!-- id:UXu7sHvc -->
