---
name: Scalar schema
summary: The variant for a scalar value (null, boolean, integer, float, string, bytes), optionally restricted by enum.
schemaDefinition: ipfs://bafyreicfziazi62kcafd4vqasyci46fa6toqfoghkvofwavlvc72wmujzq
---
This document describes the **onyx-scalar-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:_2uzPk_g -->

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
  - `params` — map ⟨ \* : [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) ⟩ <!-- id:yg8qUnxp -->

# Depends on <!-- id:TfDCyaJ4 -->
- [schema](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/schema) <!-- id:dI-HwBiD -->