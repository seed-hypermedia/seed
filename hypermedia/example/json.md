---
name: "Example: JSON Value"
summary: "A recursive JSON value: null, boolean, number, string, list, or map. References itself."
schemaDefinition: ipfs://bafyreid5g6mzeabh5uww3puoakkqdfanyg5j3nfzqd34vwwy7dhayv2jy4
---
This document describes the **example/json** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:3z3l-Qim -->

# Shape <!-- id:MpnY_Cdp -->

A **union** — a value matches one of these variants: <!-- id:LeYxSEKh -->
  - [null](../null.md) <!-- id:dlUEmbPh -->
  - [boolean](../boolean.md) <!-- id:WAJK2blO -->
  - [integer](../integer.md) <!-- id:ilz7JEhq -->
  - [float](../float.md) <!-- id:9h0fuk1V -->
  - [string](../string.md) <!-- id:HsFuiAVe -->
  - list of [example/json](./json.md) <!-- id:LjwzOynV -->
  - map ⟨ \* : [example/json](./json.md) ⟩ <!-- id:EvT76FYf -->

# Depends on <!-- id:-Dr_wY1e -->

- [boolean](../boolean.md) <!-- id:-g3SgUVF -->
- [float](../float.md) <!-- id:irteeJM_ -->
- [integer](../integer.md) <!-- id:7Jtvm8Zo -->
- [null](../null.md) <!-- id:M_y7MmNP -->
- [string](../string.md) <!-- id:f_KyPTCR -->
