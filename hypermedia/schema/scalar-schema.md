---
name: Scalar schema
summary: The variant for a null, boolean, integer, float, string or bytes value, optionally narrowed by value constraints.
---
A scalar schema describes one single value that is not a collection. There are six scalar [kinds](./kind.md): null, boolean, integer, float, string and bytes. Value constraints such as `minLength`, `pattern` and `minimum` can narrow what the schema accepts. For example, `{"type": "hm://hyper.media/string", "minLength": 1}` is a string that is not empty. To allow only one exact value, use a [literal](./literal-schema.md). <!-- id:jWUJJ6x_ -->

This page defines the **schema/scalar-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:_2uzPk_g -->

# See also <!-- id:AVyD0PiQ -->

- [Literal schema](./literal-schema.md): a schema that accepts exactly one value. <!-- id:5mZ30Uq6 -->
- [Primitive](./primitive.md): the library schema for each kind. <!-- id:YXmqTh7j -->
- [The data model](./data-model.md): the nine kinds. <!-- id:-lhdBQD5 -->
- [The schema language](./schema-language.md): value constraints and the rest of the vocabulary. <!-- id:l2A60l-M -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:TBJ87yQg -->
