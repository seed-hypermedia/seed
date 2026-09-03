---
name: File block
summary: A file attachment, referenced by a URL.
schemaDefinition: ipfs://bafyreidc4ixnykgyp2juyqewrni3l3oert6ccaqrs3i3pwa3zjyluoao6e
---
This document describes the **hypermedia-block-file** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NBx9Tnq9 -->

# Shape <!-- id:LvbrriHo -->

**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:SuWQgFEy -->
  - `type` — `string` enum: `File` <!-- id:F3pQOCmC -->
  - `link` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:64jUo2lD -->
  - `attributes` — map { 4 fields } <!-- id:0Ah1D5v4 -->

# Depends on <!-- id:nEr--yZq -->

- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:3JyMNiV0 -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:twboh5V7 -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:SbzddHuS -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:LO7gu58X -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:b8oDszzV -->
