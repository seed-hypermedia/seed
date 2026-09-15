---
name: "Example: Filesystem Entry"
summary: Either a folder or a file (a union).
schemaDefinition: ipfs://bafyreidatcny34iffq5sucivyr2viqilw5ewdquttk2gncp3tncxaj2icm
---
This document describes the **example/entry** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:zrQMizve -->

# Shape <!-- id:OLTnHt0g -->

A **union** — a value matches one of these variants: <!-- id:y2EoSoVb -->
  - [example/folder](./folder.md) <!-- id:pua_KnH- -->
  - [example/file](./file.md) <!-- id:T4GbTWiK -->

# Depends on <!-- id:3_lmgCQY -->

- [example/file](./file.md) <!-- id:oR5BhBVU -->
- [example/folder](./folder.md) <!-- id:zRU3Wyuw -->
