---
name: SetAttributes op
summary: Set attributes on a block, or document-level metadata when block is empty.
schemaDefinition: ipfs://bafyreiadtd277hkr5ylb5tcgm3dfoqtsjvql3sv37lttr2frslbxo3vnya
---
This document describes the **hypermedia-op-set-attributes** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:pyCYTEeq -->

# Shape <!-- id:LAfbycov -->

A **closed struct** with these fields: <!-- id:t_VD1Nku -->
  - `type` _(required)_ — `string` enum: `SetAttributes` <!-- id:8RrVMKzp -->
  - `block` — [string](./onyx-string.md) <!-- id:DNLUlw3V -->
  - `attrs` — list of [hypermedia-key-value](./hypermedia-key-value.md) <!-- id:fYFXgIHc -->

# Depends on <!-- id:LkWlsBr_ -->

- [hypermedia-key-value](./hypermedia-key-value.md) <!-- id:XnogVOLT -->
- [string](./onyx-string.md) <!-- id:wW3E9OCx -->
