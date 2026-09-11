---
name: MoveBlocks op
summary: Move blocks under a parent, using RGA CRDT reference ids.
schemaDefinition: ipfs://bafyreieokbjz2yiijk2ekbcsoea5ghic7eqgm5v6lgyimypk2elcyueiee
---
This document describes the **hypermedia-op-move-blocks** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:niF7ZUUC -->

# Shape <!-- id:IA76HbOX -->

A **closed struct** with these fields: <!-- id:dhIYxPj9 -->
  - `type` _(required)_ — `"MoveBlocks"` <!-- id:NTqXHSfq -->
  - `parent` — [string](./hypermedia-string.md) <!-- id:6ypREaYl -->
  - `blocks` _(required)_ — list of [string](./hypermedia-string.md) <!-- id:-kAVnOCA -->
  - `ref` — list of [integer](./hypermedia-integer.md) <!-- id:Iz-XiAnh -->

# Depends on <!-- id:9VGfsEKn -->

- [string](./hypermedia-string.md) <!-- id:AmT0qRL2 -->
