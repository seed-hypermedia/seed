---
name: Annotation
summary: An inline text annotation (bold, link, …) over character ranges, plus arbitrary inline attributes.
schemaDefinition: ipfs://bafyreidlrsbej5yvvya3ypzswo25jvbxjgexs5b4mmssh5bzynppzvlf44
---
This document describes the **hypermedia-annotation** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:G0vvOmGK -->

# Shape <!-- id:khrAA7LZ -->

A map with these fields: <!-- id:bMk3d1tZ -->
  - `type` — [string](./onyx-string.md) <!-- id:a1TPf35c -->
  - `link` — [string](./onyx-string.md) <!-- id:rq09OGe_ -->
  - `starts` — list of [integer](./onyx-integer.md) <!-- id:2e_csJ9j -->
  - `ends` — list of [integer](./onyx-integer.md) <!-- id:FCMIb0ht -->

# Depends on <!-- id:e4_snnas -->

- [hypermedia-value](./hypermedia-value.md) <!-- id:7CFu_PC8 -->
- [integer](./onyx-integer.md) <!-- id:3JNyZx61 -->
- [string](./onyx-string.md) <!-- id:_RMX_0uo -->
