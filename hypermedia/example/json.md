---
name: "Example: JSON value"
summary: "A recursive JSON value: null, boolean, number, string, list, or map. References itself."
schemaDefinition: ipfs://bafyreiazv5ertjl7wdky3kuh5aat7kihwcri4vh7kvm3rtvmnn3oaegjg4
---
This document describes the **example/json** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:3z3l-Qim -->

# Shape <!-- id:MpnY_Cdp -->

A **union** — a value matches one of these variants: <!-- id:LeYxSEKh -->
  - [null](../schema/null.md) <!-- id:dlUEmbPh -->
  - [boolean](../schema/boolean.md) <!-- id:WAJK2blO -->
  - [integer](../schema/integer.md) <!-- id:ilz7JEhq -->
  - [float](../schema/float.md) <!-- id:9h0fuk1V -->
  - [string](../schema/string.md) <!-- id:HsFuiAVe -->
  - list of [example/json](./json.md) <!-- id:LjwzOynV -->
  - map ⟨ \* : [example/json](./json.md) ⟩ <!-- id:EvT76FYf -->

# Depends on <!-- id:-Dr_wY1e -->

- [boolean](../schema/boolean.md) <!-- id:-g3SgUVF -->
- [float](../schema/float.md) <!-- id:irteeJM_ -->
- [integer](../schema/integer.md) <!-- id:7Jtvm8Zo -->
- [null](../schema/null.md) <!-- id:M_y7MmNP -->
- [string](../schema/string.md) <!-- id:f_KyPTCR -->
