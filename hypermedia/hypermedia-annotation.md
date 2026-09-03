---
name: Annotation
summary: An inline text annotation (bold, link, …) over character ranges, plus arbitrary inline attributes.
schemaDefinition: ipfs://bafyreidlrsbej5yvvya3ypzswo25jvbxjgexs5b4mmssh5bzynppzvlf44
---
This document describes the **hypermedia-annotation** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:G0vvOmGK -->

# Shape <!-- id:khrAA7LZ -->
A map with these fields: <!-- id:bMk3d1tZ -->
  - `type` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:a1TPf35c -->
  - `link` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:rq09OGe_ -->
  - `starts` — list of [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:2e_csJ9j -->
  - `ends` — list of [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:FCMIb0ht -->

# Depends on <!-- id:e4_snnas -->
- [hypermedia-value](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-value) <!-- id:7CFu_PC8 -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:3JNyZx61 -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:_RMX_0uo -->