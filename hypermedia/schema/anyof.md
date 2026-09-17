---
name: Union schema
summary: The variant for a union, which accepts a value that matches any one of the schemas listed under anyOf.
schemaDefinition: ipfs://bafyreiawraamq64cfpdznnomzl3rsbf35s4zpgb3gcijvlgdhlx2qkug3u
---
**`anyOf`**: the union keyword. It holds a list of [schemas](../schema.md), and a value is valid if it matches any of them. It is the one composite construct in [the schema language](./schema-language.md). A union whose arms are all literals is a fixed set of choices (`{anyOf: ["draft", "published"]}`), which the editors show as a dropdown. <!-- id:ppR9ujjo -->

This document describes the **schema/anyof** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:C3PmGxab -->

A union lists alternative schemas under `anyOf`. A value is valid if it matches any of them. When every arm is a [literal](./literal-schema.md), the union is a fixed set of choices, such as `{"anyOf": ["draft", "published", "archived"]}`. The editors offer that union as a dropdown. <!-- id:_g0zYO8Q -->

# Shape <!-- id:0stCYc3t -->

A **closed struct** with these fields: <!-- id:Y_Txjo0B -->
  - `anyOf` _(required)_: list of [schema](../schema.md) <!-- id:aPkIeirH -->
  - `name`: `string` <!-- id:zfJVsmkn -->
  - `description`: `string` <!-- id:Mfcuk4fO -->
  - `params`: map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:WIZIEvso -->

# Depends on <!-- id:KU0BDVHI -->

- [schema](../schema.md) <!-- id:XRX69ozh -->

# See also

- [Discriminated union](./discriminated-union.md): how the meta-schema tells its variants apart.
- [Literal schema](./literal-schema.md): the arms of a fixed set of choices.
- [Variant](./variant.md): the members of the meta-schema union.
- [The schema language](./schema-language.md): the full vocabulary.
