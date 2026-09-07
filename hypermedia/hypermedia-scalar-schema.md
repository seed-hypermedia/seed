---
name: Scalar schema
summary: The variant for a scalar value (null, boolean, integer, float, string, bytes), optionally restricted by enum.
schemaDefinition: ipfs://bafyreian47jalhpb7jvmbnwyfjdhkabu7tllpbnxp74np2dkohounqcm7e
---
This document describes the **hypermedia-scalar-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:_2uzPk_g -->

# Shape <!-- id:hPRsOwRZ -->

A **closed struct** with these fields: <!-- id:rcFn9Ub4 -->
  - `type` _(required)_ — `string` enum: `null` `boolean` `integer` `float` `string` `bytes` <!-- id:2VHPrDaY -->
  - `enum` — list of any <!-- id:37MI11wM -->
  - `minLength` — `integer` <!-- id:EbYp121n -->
  - `maxLength` — `integer` <!-- id:O9bBhW5v -->
  - `pattern` — `string` <!-- id:qMEWjTdR -->
  - `minimum` — `integer` <!-- id:3pUbMA-- -->
  - `maximum` — `integer` <!-- id:pfQyXxpR -->
  - `name` — `string` <!-- id:zMmY3mCD -->
  - `description` — `string` <!-- id:UJp1sZQT -->
  - `params` — map ⟨ \* : [schema](./hypermedia-schema.md) ⟩ <!-- id:yg8qUnxp -->

# Depends on <!-- id:TfDCyaJ4 -->

- [schema](./hypermedia-schema.md) <!-- id:dI-HwBiD -->
