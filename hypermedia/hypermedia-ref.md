---
name: Ref
summary: A signed pointer (like a Git ref) claiming that a path in a space points at the current head Changes of a document.
schemaDefinition: ipfs://bafyreidwhsrp4gcbkcgnu4p5lk6btdtki6kr2f3ve6sbdzuh66e4di4hsy
---
This document describes the **hypermedia-ref** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5X7JPVaE -->

# Shape <!-- id:dpE2fWQB -->

**Extends** [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) with these added fields: <!-- id:6u-Qshey -->
  - `type` — `string` enum: `Ref` <!-- id:4LKiQ2kT -->
  - `space` — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:idNr9FJM -->
  - `path` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:8izgFQy0 -->
  - `genesisBlob` — [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:cob0_GUo -->
  - `capability` — [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:Wv5xpNAJ -->
  - `heads` _(required)_ — list of [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:_B1tM30h -->
  - `redirect` — [hypermedia-redirect-target](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-redirect-target) <!-- id:F5YoHwBj -->
  - `generation` — [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:tPhi-Hlj -->
  - `visibility` — [hypermedia-visibility](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-visibility) <!-- id:CgsyURu- -->

# Depends on <!-- id:L4KMjf3U -->

- [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) <!-- id:qR-dN0GK -->
- [hypermedia-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-cid) <!-- id:h6XHAqQF -->
- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:CCI4-2aZ -->
- [hypermedia-redirect-target](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-redirect-target) <!-- id:x_NaRzFr -->
- [hypermedia-visibility](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-visibility) <!-- id:CDnB2GqZ -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:1vZFCegM -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:B2_Qyt3Z -->
