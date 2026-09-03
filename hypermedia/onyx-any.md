---
name: Any
summary: "The top type — matches any Onyx value: null, boolean, number, string, bytes, link, or a (recursively any) list or map. Use it for open, forward-compatible data."
schemaDefinition: ipfs://bafyreicnpxaolfgwrbbqmppvqf42lsoafmmptdkstmbbrqks2uo5s4x5ly
---
This document describes the **onyx-any** type — a primitive. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:oO6eJaVw -->

# Shape <!-- id:B6ckZa1m -->
A **union** — a value matches one of these variants: <!-- id:6EezA2oG -->
  - [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:cWQtIR13 -->
  - [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:8wkCTWj0 -->
  - [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:yhTYx7Wv -->
  - [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:q_ivdjoq -->
  - [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:iXK9KfV0 -->
  - [bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/bytes) <!-- id:oowqeiVG -->
  - [link](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/link) <!-- id:5jlyKmWE -->
  - list of [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:HOSZE8Y1 -->
  - map ⟨ \* : [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) ⟩ <!-- id:zhX2rUxo -->

# Depends on <!-- id:J36yzGwM -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:GtOFz5XG -->
- [bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/bytes) <!-- id:KPaOP9M- -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:ORak9602 -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:8pn0Cxu_ -->
- [link](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/link) <!-- id:w35p-zQq -->
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:3eQVhAK1 -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Wgktcf4G -->