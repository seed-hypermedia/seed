---
name: Union schema
summary: The variant for a union, which accepts a value that matches any one of the schemas listed under anyOf.
---
**`anyOf`**: the union keyword. It holds a list of [schemas](../schema.md), and a value is valid if it matches any of them. It is the one composite construct in [the schema language](./schema-language.md). A union whose arms are all literals is a fixed set of choices (`{anyOf: ["draft", "published"]}`), which the editors show as a dropdown. <!-- id:ppR9ujjo -->

This document describes the **schema/anyof** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:C3PmGxab -->

A union lists alternative schemas under `anyOf`. A value is valid if it matches any of them. When every arm is a [literal](./literal-schema.md), the union is a fixed set of choices, such as `{"anyOf": ["draft", "published", "archived"]}`. The editors offer that union as a dropdown. <!-- id:_g0zYO8Q -->

An empty union, `{"anyOf": []}`, accepts no values. The library names this schema [none](../none.md). It differs from the literal schema `null`, which accepts the single value `null`. <!-- id:54sH8-hG -->

# See also <!-- id:xg9bzB-w -->

- [Discriminated union](./discriminated-union.md): how the meta-schema tells its variants apart. <!-- id:va1B0ATe -->
- [Literal schema](./literal-schema.md): the arms of a fixed set of choices. <!-- id:nd5iDqi2 -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:lUeQ0ocD -->
- [The schema language](./schema-language.md): the full vocabulary. <!-- id:UXiXY6xp -->
