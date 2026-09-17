---
name: Scalar schema
summary: The variant for a null, boolean, integer, float, string or bytes value, optionally narrowed by value constraints.
schemaDefinition: ipfs://bafyreidw7cbrno7c2vuralbpuj2a5d6xi4iu2oczcggp5rvqcotz4cgql4
---
A scalar schema types one of the six scalar [kinds](./kind.md). Value constraints such as `minLength`, `pattern` and `minimum` can narrow it. To pin a scalar to one value, use a [literal](./literal-schema.md).

This document describes the **schema/scalar-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). Its formal schema is attached as the `schemaDefinition` in this document's [metadata](../metadata.md), so the app can show it and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:_2uzPk_g -->

# Shape <!-- id:hPRsOwRZ -->

A **closed struct** with these fields: <!-- id:rcFn9Ub4 -->
  - `type` _(required)_: one of `"null"` | `"boolean"` | `"integer"` | `"float"` | `"string"` | `"bytes"` <!-- id:2VHPrDaY -->
  - `minLength`: `integer` <!-- id:EbYp121n -->
  - `maxLength`: `integer` <!-- id:O9bBhW5v -->
  - `pattern`: `string` <!-- id:qMEWjTdR -->
  - `format`: `string`
  - `target`: `string`
  - `minimum`: `integer` <!-- id:3pUbMA-- -->
  - `maximum`: `integer` <!-- id:pfQyXxpR -->
  - `name`: `string` <!-- id:zMmY3mCD -->
  - `description`: `string` <!-- id:UJp1sZQT -->
  - `params`: map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:yg8qUnxp -->

# Depends on <!-- id:TfDCyaJ4 -->

- [schema](../schema.md) <!-- id:dI-HwBiD -->

# See also

- [Literal schema](./literal-schema.md): a schema that accepts exactly one value.
- [Primitive](./primitive.md): the library schema for each kind.
- [The data model](./data-model.md): the nine kinds.
- [The schema language](./schema-language.md): value constraints and the rest of the vocabulary.
- [Variant](./variant.md): the members of the meta-schema union.
