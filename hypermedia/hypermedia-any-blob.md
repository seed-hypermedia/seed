---
name: Any blob
summary: Any Hypermedia CBOR blob — the discriminated union of the six blob types, tagged on the type field.
schemaDefinition: ipfs://bafyreihlyif2xmsulnhgrq7erc5c5av37rylkgr5bothck66ixkjvobxbm
---
This document describes the **hypermedia-any-blob** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:uf3sIMOH -->

# Shape <!-- id:vU-ROV7h -->
A **union** — a value matches one of these variants: <!-- id:TsnOcutU -->
  - [hypermedia-change](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-change) <!-- id:bRPYzuid -->
  - [hypermedia-ref](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ref) <!-- id:EP8vzpnL -->
  - [hypermedia-profile](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-profile) <!-- id:ThGWnfaK -->
  - [hypermedia-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-comment) <!-- id:BsccYSi3 -->
  - [hypermedia-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-capability) <!-- id:xofU45np -->
  - [hypermedia-contact](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-contact) <!-- id:qvwBCe01 -->

# Depends on <!-- id:7fzRuDS8 -->
- [hypermedia-capability](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-capability) <!-- id:IoFhiaE3 -->
- [hypermedia-change](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-change) <!-- id:UhG4UV8N -->
- [hypermedia-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-comment) <!-- id:ZsN-8iYj -->
- [hypermedia-contact](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-contact) <!-- id:5v8hyrIb -->
- [hypermedia-profile](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-profile) <!-- id:DiDCtHSa -->
- [hypermedia-ref](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ref) <!-- id:WAyUTcQu -->