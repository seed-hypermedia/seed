---
name: MoveBlocks Op
summary: Move blocks under a parent, using RGA CRDT reference ids.
schemaDefinition: ipfs://bafyreihivwjksbvqtfh6hzosjx5qsvbujjcnp7lzzooy7vkxdrrxp4dyae
---
This document describes the **change/op/move-blocks** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:niF7ZUUC -->

# Shape <!-- id:IA76HbOX -->

A **closed struct** with these fields: <!-- id:dhIYxPj9 -->
  - `type` _(required)_ — `"MoveBlocks"` <!-- id:NTqXHSfq -->
  - `parent` — [string](../../string.md) <!-- id:6ypREaYl -->
  - `blocks` _(required)_ — list of [string](../../string.md) <!-- id:-kAVnOCA -->
  - `ref` — list of [integer](../../integer.md) <!-- id:Iz-XiAnh -->

# Depends on <!-- id:9VGfsEKn -->

- [string](../../string.md) <!-- id:AmT0qRL2 -->
