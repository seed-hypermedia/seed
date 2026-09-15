---
name: Any Blob
summary: Any Hypermedia CBOR blob — the discriminated union of the six blob types, tagged on the type field.
schemaDefinition: ipfs://bafyreicc764ssni7c77whny66rzlz2w2md4mvmxmw5ekggo2s2vnak2y5e
---
This document describes the **blob/any** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:uf3sIMOH -->

# Shape <!-- id:vU-ROV7h -->

A **union** — a value matches one of these variants: <!-- id:TsnOcutU -->
  - [change](../change.md) <!-- id:bRPYzuid -->
  - [ref](../ref.md) <!-- id:EP8vzpnL -->
  - [profile](../profile.md) <!-- id:ThGWnfaK -->
  - [comment](../comment.md) <!-- id:BsccYSi3 -->
  - [capability](../capability.md) <!-- id:xofU45np -->
  - [contact](../contact.md) <!-- id:qvwBCe01 -->

# Depends on <!-- id:7fzRuDS8 -->

- [capability](../capability.md) <!-- id:IoFhiaE3 -->
- [change](../change.md) <!-- id:UhG4UV8N -->
- [comment](../comment.md) <!-- id:ZsN-8iYj -->
- [contact](../contact.md) <!-- id:5v8hyrIb -->
- [profile](../profile.md) <!-- id:DiDCtHSa -->
- [ref](../ref.md) <!-- id:WAyUTcQu -->
