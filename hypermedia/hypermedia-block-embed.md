---
name: Embed block
summary: An embed of another Hypermedia document (an hm:// URL).
schemaDefinition: ipfs://bafyreidexpmm2brpox4rg53nlys7or6zfkrymjiiejd5ldtmucx2shphgq
---
This document describes the **hypermedia-block-embed** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qn5BFYI8 -->

# Shape <!-- id:9EPhCUJT -->
**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:2GRM9nIh -->
  - `type` — `string` enum: `Embed` <!-- id:b2zVVm3u -->
  - `link` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:ZiIxjP4h -->
  - `attributes` — map { 3 fields } <!-- id:WnM5P0qp -->

# Depends on <!-- id:MWtO8JbA -->
- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:2Avgtd9- -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:oXOIFz_v -->
- [hypermedia-embed-view](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-embed-view) <!-- id:X-BCjyL7 -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:hINcbD3U -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:tf1LXPAe -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:dAdcfEkv -->