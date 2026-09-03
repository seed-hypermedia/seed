---
name: MoveBlocks op
summary: Move blocks under a parent, using RGA CRDT reference ids.
schemaDefinition: ipfs://bafyreibcbvj2i3x7ccplchu3ip62ecjq7ebfzplutcwdvjor7iras2gr7a
---
This document describes the **hypermedia-op-move-blocks** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:niF7ZUUC -->

# Shape <!-- id:IA76HbOX -->

A **closed struct** with these fields: <!-- id:dhIYxPj9 -->
  - `type` _(required)_ — `string` enum: `MoveBlocks` <!-- id:NTqXHSfq -->
  - `parent` — [string](./onyx-string.md) <!-- id:6ypREaYl -->
  - `blocks` _(required)_ — list of [string](./onyx-string.md) <!-- id:-kAVnOCA -->
  - `ref` — list of [integer](./onyx-integer.md) <!-- id:Iz-XiAnh -->

# Depends on <!-- id:9VGfsEKn -->

- [string](./onyx-string.md) <!-- id:AmT0qRL2 -->
