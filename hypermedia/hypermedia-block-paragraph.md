---
name: Paragraph block
summary: A paragraph of rich text with annotations.
schemaDefinition: ipfs://bafyreid2a35b6aseb2dwnsriele7wivfkdy5fbfq7npioxtxppzln2fm4y
---
This document describes the **hypermedia-block-paragraph** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Vou7cbhc -->

# Shape <!-- id:l0o5Tte_ -->

**Extends** [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) with these added fields: <!-- id:a3oACyxn -->
  - `type` — `string` enum: `Paragraph` <!-- id:tHz4ynCQ -->
  - `text` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:_0H0S0T5 -->
  - `annotations` — list of [hypermedia-annotation](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-annotation) <!-- id:pXxDvrgh -->
  - `attributes` — map { 3 fields } <!-- id:ohl09HNZ -->

# Depends on <!-- id:yL-NVw3Z -->

- [hypermedia-annotation](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-annotation) <!-- id:T-dO1QZb -->
- [hypermedia-block-base](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-base) <!-- id:-NxYvbtm -->
- [hypermedia-children-type](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-children-type) <!-- id:YV6PY--I -->
- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any) <!-- id:Kyh6AeJj -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:MOYG_rHe -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:Pf_eLNrP -->
