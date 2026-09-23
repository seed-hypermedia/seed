---
name: Literal Schema
summary: The variant for a literal, which is a schema that accepts exactly one value and can describe what that value means.
---
**Literal**: a schema that accepts exactly one value. You write it as the value itself (`"Change"`, `1`, `true`, `null`), or as `{value, description}` when the value needs an explanation. Only a string, integer, boolean or null can be a literal. [The schema language](./schema-language.md) covers literals with the rest of the vocabulary. <!-- id:--m2-2zx -->

A literal schema accepts exactly one value. Most literals are written as the value itself, such as `"draft"`, `1`, `true` or `null`, and need no variant at all: a bare string, integer, boolean or null is a schema. This variant is the long form, `{value, description}`, for a literal that needs an explanation, such as one choice among several in a [union](./anyof.md). <!-- id:1xTsRaHa -->

A fixed set of choices is a union of literals: `{"anyOf": ["draft", {"value": "published", "description": "Visible to everyone"}, "archived"]}`. The editors show such a union as a dropdown, with each description beside its option. A field pinned to one value is that literal. The `type` tag of every [signed blob](../protocol/blobs.md) and the `key` of every [Seed API](../build/web-api.md) request work this way: `"type": {"value": "Change", "required": true}`. <!-- id:CvYPTOfS -->

A literal can only be a [value](../value.md): a string, an integer, a boolean or null. A map literal would look exactly like a schema, and floats do not compare reliably. <!-- id:6Nz5fcWH -->

# See also <!-- id:u_bGQptH -->

- [Union schema](./anyof.md): a fixed set of choices is a union of literals. <!-- id:yPpUkUyi -->
- [Scalar schema](./scalar-schema.md): a scalar kind with constraints, where a literal pins one value. <!-- id:8SeSkGvo -->
- [Kind](./kind.md): the value types a literal can come from. <!-- id:7FM5raw1 -->
- [The schema language](./schema-language.md): the full vocabulary. <!-- id:N2gmy57a -->
- [Blob](../blob.md): every signed blob pins its `type` tag with a literal. <!-- id:fKqo5q4w -->
