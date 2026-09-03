---
name: "Example: JSON value"
summary: "A recursive JSON value: null, boolean, number, string, list, or map. References itself."
schemaDefinition: ipfs://bafyreigkweonxbt7kxaxbnsn4tb7y3wo2aehxytoy67cypb5xldvzhdf4m
---
This document describes the **example-json** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:3z3l-Qim -->

# Shape <!-- id:MpnY_Cdp -->

A **union** — a value matches one of these variants: <!-- id:LeYxSEKh -->
  - [null](./onyx-null.md) <!-- id:dlUEmbPh -->
  - [boolean](./onyx-boolean.md) <!-- id:WAJK2blO -->
  - [integer](./onyx-integer.md) <!-- id:ilz7JEhq -->
  - [float](./onyx-float.md) <!-- id:9h0fuk1V -->
  - [string](./onyx-string.md) <!-- id:HsFuiAVe -->
  - list of [example-json](./example-json.md) <!-- id:LjwzOynV -->
  - map ⟨ \* : [example-json](./example-json.md) ⟩ <!-- id:EvT76FYf -->

# Depends on <!-- id:-Dr_wY1e -->

- [boolean](./onyx-boolean.md) <!-- id:-g3SgUVF -->
- [float](./onyx-float.md) <!-- id:irteeJM_ -->
- [integer](./onyx-integer.md) <!-- id:7Jtvm8Zo -->
- [null](./onyx-null.md) <!-- id:M_y7MmNP -->
- [string](./onyx-string.md) <!-- id:f_KyPTCR -->
