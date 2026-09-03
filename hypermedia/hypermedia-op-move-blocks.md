---
name: MoveBlocks op
summary: Move blocks under a parent, using RGA CRDT reference ids.
schemaDefinition: ipfs://bafyreiamljr7sqst2ufa54cbsisqmoca4uu4bsjn5vsytmkxcusiq5sk3y
---
This document describes the **hypermedia-op-move-blocks** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:niF7ZUUC -->

# Shape <!-- id:IA76HbOX -->

A **closed struct** with these fields: <!-- id:dhIYxPj9 -->
  - `type` _(required)_ — `string` enum: `MoveBlocks` <!-- id:NTqXHSfq -->
  - `parent` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:6ypREaYl -->
  - `blocks` _(required)_ — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:-kAVnOCA -->
  - `ref` — list of [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:Iz-XiAnh -->

# Depends on <!-- id:9VGfsEKn -->

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:AmT0qRL2 -->
