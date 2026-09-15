---
name: Annotation
summary: An inline text annotation (bold, link, …) over character ranges, plus arbitrary inline attributes.
schemaDefinition: ipfs://bafyreic7vkt2cnk7vf4ln37qt4ol2zgm4ar7w2xpifaa5jvbz4ccvnbxce
---
This document describes the **block/annotation** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:G0vvOmGK -->

# Shape <!-- id:khrAA7LZ -->

A map with these fields: <!-- id:bMk3d1tZ -->
  - `type` — [string](../string.md) <!-- id:a1TPf35c -->
  - `link` — [string](../string.md) <!-- id:rq09OGe_ -->
  - `starts` — list of [integer](../integer.md) <!-- id:2e_csJ9j -->
  - `ends` — list of [integer](../integer.md) <!-- id:FCMIb0ht -->

# Depends on <!-- id:e4_snnas -->

- [value](../value.md) <!-- id:7CFu_PC8 -->
- [integer](../integer.md) <!-- id:3JNyZx61 -->
- [string](../string.md) <!-- id:_RMX_0uo -->
