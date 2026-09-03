---
name: Video block
summary: A video, referenced by a URL.
schemaDefinition: ipfs://bafyreiclexvqahzdmqmaciqmpau5kcvza7eudy5qqj43zi6te5wiluyhoq
---
This document describes the **hypermedia-block-video** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:EYK9AnN- -->

# Shape <!-- id:P9bV1JXS -->
**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:kf5ps0sg -->
  - `type` — `string` enum: `Video` <!-- id:5rdECHj3 -->
  - `link` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:efxgTfxI -->
  - `attributes` — map { 7 fields } <!-- id:B0S2hL6h -->

# Depends on <!-- id:zuMUGUt2 -->
- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:YMbblegu -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:euMK0Tqe -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:7biHOJn7 -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:669ZOxEU -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:vMQpMpWI -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:rDzm7GKO -->