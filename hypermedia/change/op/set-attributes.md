---
name: SetAttributes Op
summary: Set attributes on a block, or document-level metadata when block is empty.
schemaDefinition: ipfs://bafyreichl2f7is3nzx2nn5hmqkipvojew2alpbwunekpgjobfciz6c3xt4
---
This document describes the **change/op/set-attributes** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:pyCYTEeq -->

# Shape <!-- id:LAfbycov -->

A **closed struct** with these fields: <!-- id:t_VD1Nku -->
  - `type` _(required)_ — `"SetAttributes"` <!-- id:8RrVMKzp -->
  - `block` — [string](../../string.md) <!-- id:DNLUlw3V -->
  - `attrs` — list of [key-value](../../key-value.md) <!-- id:fYFXgIHc -->

# Depends on <!-- id:LkWlsBr_ -->

- [key-value](../../key-value.md) <!-- id:XnogVOLT -->
- [string](../../string.md) <!-- id:wW3E9OCx -->
