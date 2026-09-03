---
name: Query block
summary: "A block that embeds a live query: its results (documents from the queried spaces) render in place, styled as cards, a list, or a table."
schemaDefinition: ipfs://bafyreic3uiaju4fvjbs2golda76qslrtl5bla5p3pm7rkjq4p2zxvmyglu
---
This document describes the **hypermedia-block-query** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:F-SfTMKY -->

# Shape <!-- id:qSgsFftP -->
**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:7mILC7mx -->
  - `type` — `string` enum: `Query` <!-- id:3yDTq8Co -->
  - `attributes` _(required)_ — map { 6 fields } <!-- id:gtQYKj6o -->

# Depends on <!-- id:-mG573Pu -->
- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:KAljEfFl -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:wzJRoaRn -->
- [hypermedia-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query) <!-- id:6wLgfWnV -->
- [hypermedia-query-style](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-style) <!-- id:QGHoUdMD -->
- [hypermedia-query-table-config](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-table-config) <!-- id:erA6yksW -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:WWZ66KvH -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:e0CF_ISb -->