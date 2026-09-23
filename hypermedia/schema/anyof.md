---
name: Union schema
summary: The variant for a union, which accepts a value that matches any one of the schemas listed under anyOf.
---
A **union** accepts a value that matches any one of several [schemas](../schema.md). You write it with the `anyOf` key, which holds the list of schemas. Each schema in the list is called an arm. For example, `{"anyOf": ["draft", "published", "archived"]}` accepts one of three words. <!-- id:ppR9ujjo -->

A union is one of the two ways [the schema language](./schema-language.md) combines schemas. The other is the [intersection](./allof.md), written `allOf`, which says _and_ where a union says _or_. When every arm is a [literal](./literal-schema.md), as in the example, the union is a fixed set of choices. The editors show it as a dropdown.

This page defines the **schema/anyof** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:C3PmGxab -->

An empty union, `{"anyOf": []}`, accepts no value at all. The library names this schema [none](../none.md). It is not the same as the literal schema `null`, which accepts the single value `null`. <!-- id:54sH8-hG -->

# See also <!-- id:xg9bzB-w -->

- [Discriminated union](./discriminated-union.md): how the meta-schema tells its variants apart. <!-- id:va1B0ATe -->
- [Literal schema](./literal-schema.md): the arms of a fixed set of choices. <!-- id:nd5iDqi2 -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:lUeQ0ocD -->
- [The schema language](./schema-language.md): the full vocabulary. <!-- id:UXiXY6xp -->
