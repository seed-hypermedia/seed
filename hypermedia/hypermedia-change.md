---
name: Change
summary: An append-only change to a document, linked into a causal DAG via deps. Carries the operations that mutate document content and metadata.
schemaDefinition: ipfs://bafyreifcga556rkidwrhbhhrygs47r3wj2jz47ioihd24acx2zner3gkku
---
This document describes the **hypermedia-change** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:v0dbkIbB -->

# Shape <!-- id:NQM1VhDF -->
**Extends** [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) with these added fields: <!-- id:WtuABanO -->
  - `type` — `string` enum: `Change` <!-- id:vuVh1zRN -->
  - `genesis` — [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:OjyRoI0Z -->
  - `deps` — list of [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:14sUK5dG -->
  - `depth` — [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:WymiRSox -->
  - `body` — [hypermedia-change-body](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-change-body)⟨Block = type variable `⟨Block⟩`⟩ <!-- id:uBgg3XsN -->

**Generic** over `⟨Block⟩` (default [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)). <!-- id:R7cLitDd -->

# Depends on <!-- id:04pSmVGM -->
- [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) <!-- id:WMAGmaBA -->
- [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block) <!-- id:FapoGwga -->
- [hypermedia-change-body](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-change-body) <!-- id:_jOGY6LF -->
- [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:63xfnTGa -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:fvXmpXcE -->