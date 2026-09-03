---
name: Image block
summary: An image, referenced by a URL (typically ipfs://).
schemaDefinition: ipfs://bafyreifykebbkmvnjt5acmscu5wv2oienz62fadquw7pvwdoufa5cd457i
---
This document describes the **hypermedia-block-image** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:VjEBnK6Y -->

# Shape <!-- id:cbXa8mno -->

**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:kPTX80QP -->
  - `type` — `string` enum: `Image` <!-- id:_SNfeCgs -->
  - `text` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:DXG_XHw7 -->
  - `annotations` — list of [hypermedia-annotation](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-annotation) <!-- id:Q7w7I2Hz -->
  - `link` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:UYcsuvkH -->
  - `attributes` — map { 4 fields } <!-- id:iqHIaSba -->

# Depends on <!-- id:YPRiA03F -->

- [hypermedia-annotation](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-annotation) <!-- id:MVA73uC9 -->
- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:DkHjROke -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:MBr7gZWy -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:Zxb9Dkoq -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:cA9WSlCZ -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:BB8A96g9 -->
