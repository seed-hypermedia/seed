---
name: Button block
summary: A labelled button linking somewhere.
schemaDefinition: ipfs://bafyreib6qnhpvo6soquwdqfonlhll5bdvwgipt6w2eaxky34e2nw5jmmlu
---
This document describes the **hypermedia-block-button** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:4MIlhf71 -->

# Shape <!-- id:xGD5dY-c -->
**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:CY2yoTm1 -->
  - `type` — `string` enum: `Button` <!-- id:6Nvnbcfu -->
  - `text` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:1F063pXv -->
  - `link` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:EESTSjCi -->
  - `attributes` — map { 4 fields } <!-- id:UxIYwOeL -->

# Depends on <!-- id:glOGR_U7 -->
- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:_0hbglqH -->
- [hypermedia-button-alignment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-button-alignment) <!-- id:W3GAkILw -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:ViB7NkN7 -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:kQPzV4Nj -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:rjjWap8S -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:dcAn-Ks- -->