---
name: Variable Schema
summary: "A type-variable reference, written { \"var\": \"<name>\" }, that matches whatever a generic's parameter is bound to."
---
A var schema is a placeholder for a type inside a [generic](./generic.md). You write it `{ "var": "<name>" }`. It matches whatever schema fills in the generic's parameter of that name. For example, `{ "var": "Block" }` inside [`change`](../change.md) stands for the [block](../protocol/blocks.md) type that the user of `change` chooses. <!-- id:GaCjwOry -->

This page defines the **schema/var-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:V8YaGKHo -->

# See also <!-- id:lsmIzExr -->

- [Generic](./generic.md): `params`, `var` and `args` together. <!-- id:b2WWl50S -->
- [Change](../change.md): `Change<Block>` is the library's generic. <!-- id:IaCLUAV8 -->
- [The schema language](./schema-language.md): the full vocabulary. <!-- id:7wrpP5Ci -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:InyyiDts -->
