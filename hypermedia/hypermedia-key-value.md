---
name: Key/value
summary: "A metadata attribute: a dotted key path (segments) and a value."
schemaDefinition: ipfs://bafyreic6kgpf7gnxggecadfzec6cldlvxzxmzsnyck65davlkylmnzphoa
---
This document describes the **hypermedia-key-value** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:KBi_5PW1 -->

# Shape <!-- id:VMONYTkt -->

A **closed struct** with these fields: <!-- id:NyettGx4 -->
  - `key` — list of [string](./hypermedia-string.md) <!-- id:STJDSKAR -->
  - `value` — [hypermedia-value](./hypermedia-value.md) <!-- id:7qky9GU7 -->

# Depends on <!-- id:vLWqKSnN -->

- [hypermedia-value](./hypermedia-value.md) <!-- id:yrWGRztM -->
- [string](./hypermedia-string.md) <!-- id:v5aghFcs -->
