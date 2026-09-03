---
name: Web embed block
summary: An embed of an external web resource (an http(s) URL).
schemaDefinition: ipfs://bafyreigjfrwmpdpip2bajmkt6lhzrhber52r54qlghxw75htmqqquqlury
---
This document describes the **hypermedia-block-web-embed** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XGtQTo6l -->

# Shape <!-- id:Q5buqKEc -->
**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:smg-tBbR -->
  - `type` — `string` enum: `WebEmbed` <!-- id:c2wlVeW6 -->
  - `link` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:-den0FTt -->

# Depends on <!-- id:U9-iiqv6 -->
- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:aptiE36d -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:vCCkhfdX -->