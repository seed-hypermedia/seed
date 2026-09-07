---
name: "Example: JSON value"
summary: "A recursive JSON value: null, boolean, number, string, list, or map. References itself."
schemaDefinition: ipfs://bafyreiaqjvicehty5dyp7sdt5v5djopmums25v6rlaozc6gotqdjvbxdae
---
This document describes the **example-json** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:3z3l-Qim -->

# Shape <!-- id:MpnY_Cdp -->

A **union** — a value matches one of these variants: <!-- id:LeYxSEKh -->
  - [null](./hypermedia-null.md) <!-- id:dlUEmbPh -->
  - [boolean](./hypermedia-boolean.md) <!-- id:WAJK2blO -->
  - [integer](./hypermedia-integer.md) <!-- id:ilz7JEhq -->
  - [float](./hypermedia-float.md) <!-- id:9h0fuk1V -->
  - [string](./hypermedia-string.md) <!-- id:HsFuiAVe -->
  - list of [example-json](./example-json.md) <!-- id:LjwzOynV -->
  - map ⟨ \* : [example-json](./example-json.md) ⟩ <!-- id:EvT76FYf -->

# Depends on <!-- id:-Dr_wY1e -->

- [boolean](./hypermedia-boolean.md) <!-- id:-g3SgUVF -->
- [float](./hypermedia-float.md) <!-- id:irteeJM_ -->
- [integer](./hypermedia-integer.md) <!-- id:7Jtvm8Zo -->
- [null](./hypermedia-null.md) <!-- id:M_y7MmNP -->
- [string](./hypermedia-string.md) <!-- id:f_KyPTCR -->
