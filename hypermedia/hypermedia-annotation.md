---
name: Annotation
summary: An inline text annotation (bold, link, …) over character ranges, plus arbitrary inline attributes.
schemaDefinition: ipfs://bafyreibhf45liynmaspothlydy5bfujwgtvpeninolletdcrdyfykon5me
---
This document describes the **hypermedia-annotation** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:G0vvOmGK -->

# Shape <!-- id:khrAA7LZ -->

A map with these fields: <!-- id:bMk3d1tZ -->
  - `type` — [string](./hypermedia-string.md) <!-- id:a1TPf35c -->
  - `link` — [string](./hypermedia-string.md) <!-- id:rq09OGe_ -->
  - `starts` — list of [integer](./hypermedia-integer.md) <!-- id:2e_csJ9j -->
  - `ends` — list of [integer](./hypermedia-integer.md) <!-- id:FCMIb0ht -->

# Depends on <!-- id:e4_snnas -->

- [hypermedia-value](./hypermedia-value.md) <!-- id:7CFu_PC8 -->
- [integer](./hypermedia-integer.md) <!-- id:3JNyZx61 -->
- [string](./hypermedia-string.md) <!-- id:_RMX_0uo -->
