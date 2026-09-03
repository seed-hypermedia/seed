---
name: Block
summary: "The open block: the common fields (id, type, text, link, annotations, attributes) plus arbitrary extra fields of any type, requiring only id and type. This is t"
schemaDefinition: ipfs://bafyreieaku5hio5mruvzgkrxseau5xfx6dnh6kkvcijcjetwdjywl4vs5q
---
The open block: the common fields (id, type, text, link, annotations, attributes) plus arbitrary extra fields of any type, requiring only id and type. This is the forward-compatible wire type Change ops and comment bodies reference — a block type this client has no schema for (a future or third-party type) is still a valid Block, so a document is never rejected over an unrecognized block. Every concrete block is a subtype; the strict recognized set is hypermedia-block-core. To ADD a block type, extend hypermedia-block-base and union it with the core (see example-poll-block / example-app-block). <!-- id:oDU4AtVK -->

This document describes the **hypermedia-block** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Je0ODJIV -->

# Shape <!-- id:QiFjidUz -->
A map with these fields: <!-- id:fsTkb0Vo -->
  - `id` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:JojT7-nZ -->
  - `revision` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:lffsHj-T -->
  - `type` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:cLTKblZl -->
  - `text` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Vp36I-vY -->
  - `link` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:C8thhIEg -->
  - `annotations` — list of [hypermedia-annotation](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-annotation) <!-- id:9JbkXwGl -->
  - `attributes` — map { 0 fields } <!-- id:wLVIaOrw -->

# Depends on <!-- id:EltAo080 -->
- [hypermedia-annotation](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-annotation) <!-- id:g8o6nDyl -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:ehYTDbOa -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:xj1lJl3u -->