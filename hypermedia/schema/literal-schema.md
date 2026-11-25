---
name: Literal Schema
summary: The variant for a literal, which is a schema that accepts exactly one value and can describe what that value means.
---
A **literal** is a schema that accepts exactly one value. You write it as the value itself (`"Change"`, `1`, `true`, `null`). When the value needs an explanation, you write it as `{value, description}`. Only a string, an integer, a boolean or null can be a literal. [The schema language](./schema-language.md) covers literals with the rest of the vocabulary. <!-- id:--m2-2zx -->

A bare string, integer, boolean or null is already a schema, and it needs no variant. This variant is the long form, `{value, description}`. Use it for a literal that needs an explanation, such as one choice among several in a [union](./anyof.md). <!-- id:1xTsRaHa -->

A fixed set of choices is a union of literals: `{"anyOf": ["draft", {"value": "published", "description": "Visible to everyone"}, "archived"]}`. The editors show such a union as a dropdown, with each description beside its option. <!-- id:CvYPTOfS -->

A field that must hold one fixed value is that literal. The `type` tag of every [signed blob](../protocol/blobs.md) works this way: `"type": {"value": "Change", "required": true}`.

The type of a literal's `value` is [value](../value.md). A map or a float cannot be a literal. A map literal would look exactly like a schema, and floats do not compare reliably. <!-- id:6Nz5fcWH -->

This page defines the **schema/literal-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. [Typed documents](./typed-documents.md) explains how that works.

# See also <!-- id:u_bGQptH -->

- [Union schema](./anyof.md): a fixed set of choices is a union of literals. <!-- id:yPpUkUyi -->
- [Scalar schema](./scalar-schema.md): a scalar kind with constraints, where a literal pins one value. <!-- id:8SeSkGvo -->
- [Kind](./kind.md): the value types a literal can come from. <!-- id:7FM5raw1 -->
- [The schema language](./schema-language.md): the full vocabulary. <!-- id:N2gmy57a -->
- [Blob](../blob.md): every signed blob pins its `type` tag with a literal. <!-- id:fKqo5q4w -->
