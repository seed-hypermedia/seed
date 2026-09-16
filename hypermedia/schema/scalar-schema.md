---
name: Scalar schema
summary: The variant for a scalar value (null, boolean, integer, float, string, bytes), optionally narrowed by value constraints. To pin a scalar to one value, use a literal.
schemaDefinition: ipfs://bafyreidw7cbrno7c2vuralbpuj2a5d6xi4iu2oczcggp5rvqcotz4cgql4
---
This document describes the **schema/scalar-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:_2uzPk_g -->

# Shape <!-- id:hPRsOwRZ -->

A **closed struct** with these fields: <!-- id:rcFn9Ub4 -->
  - `type` _(required)_ — one of `"null"` | `"boolean"` | `"integer"` | `"float"` | `"string"` | `"bytes"` <!-- id:2VHPrDaY -->
  - `minLength` — `integer` <!-- id:EbYp121n -->
  - `maxLength` — `integer` <!-- id:O9bBhW5v -->
  - `pattern` — `string` <!-- id:qMEWjTdR -->
  - `minimum` — `integer` <!-- id:3pUbMA-- -->
  - `maximum` — `integer` <!-- id:pfQyXxpR -->
  - `name` — `string` <!-- id:zMmY3mCD -->
  - `description` — `string` <!-- id:UJp1sZQT -->
  - `params` — map ⟨ \* : [schema](../schema.md) ⟩ <!-- id:yg8qUnxp -->

# Depends on <!-- id:TfDCyaJ4 -->

- [schema](../schema.md) <!-- id:dI-HwBiD -->
