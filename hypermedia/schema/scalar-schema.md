---
name: Scalar schema
summary: The variant for a null, boolean, integer, float, string or bytes value, optionally narrowed by value constraints.
---
A scalar schema types one of the six scalar [kinds](./kind.md). Value constraints such as `minLength`, `pattern` and `minimum` can narrow it. To pin a scalar to one value, use a [literal](./literal-schema.md). <!-- id:jWUJJ6x_ -->

This document describes the **schema/scalar-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:_2uzPk_g -->

# See also <!-- id:AVyD0PiQ -->

- [Literal schema](./literal-schema.md): a schema that accepts exactly one value. <!-- id:5mZ30Uq6 -->
- [Primitive](./primitive.md): the library schema for each kind. <!-- id:YXmqTh7j -->
- [The data model](./data-model.md): the nine kinds. <!-- id:-lhdBQD5 -->
- [The schema language](./schema-language.md): value constraints and the rest of the vocabulary. <!-- id:l2A60l-M -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:TBJ87yQg -->
