---
name: Code block
summary: A code block, optionally tagged with a language.
schemaDefinition: ipfs://bafyreiegtreqenpoawxgn7q2z7yp27nrhuzjpnxczk664bq4dcvwhirixm
---
This document describes the **hypermedia-block-code** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:fqG3-TI_ -->

# Shape <!-- id:Wlv2TURN -->

**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:M3xZk6r7 -->
  - `type` — `string` enum: `Code` <!-- id:F_X9vLc- -->
  - `text` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:1CNgUNEp -->
  - `attributes` — map { 3 fields } <!-- id:IzYor5cE -->

# Depends on <!-- id:1PZKCBGr -->

- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:UPJREQHL -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:lrSmJj0P -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:FPY-Yu6f -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:dPDYHZ7F -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:ui04XeY6 -->
