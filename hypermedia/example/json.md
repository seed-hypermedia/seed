---
name: "Example: JSON Value"
summary: "A recursive JSON value: null, boolean, number, string, list, or map."
schemaDefinition: ipfs://bafyreibx2s7qud2cc7miwkswlp3egvtbh5ok6z7eijirwune6zflpud6x4
---
A JSON value: null, boolean, integer, float, string, a list of JSON values, or a map of JSON values. It is a recursive [union](../schema/anyof.md) that refers to itself by [name](../schema/references.md).

This page describes the **example/json** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:3z3l-Qim -->

# Shape <!-- id:MpnY_Cdp -->

A **union**. A value matches one of these variants: <!-- id:LeYxSEKh -->
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

# See also

- [value](./value.md): a non-recursive primitive union.
- [Union](../schema/anyof.md): how `anyOf` works.
- [References](../schema/references.md): why recursion works.
- [Examples](../example.md): every example, grouped by feature.
