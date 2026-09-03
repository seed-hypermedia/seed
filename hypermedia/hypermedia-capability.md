---
name: Capability
summary: A delegation granting a role (WRITER or AGENT) from a space owner (the signer) to a delegate key, optionally scoped to a path.
schemaDefinition: ipfs://bafyreidrbogadinyf4msbr67mefudmuijnznzd4jyumxnqocwvfozaxgny
---
This document describes the **hypermedia-capability** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:EoJZUC30 -->

# Shape <!-- id:Z4Q_8BDH -->

**Extends** [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) with these added fields: <!-- id:r1SXPido -->
  - `type` — `string` enum: `Capability` <!-- id:SyOFox8W -->
  - `delegate` _(required)_ — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:kjRR_hac -->
  - `audience` — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:7U5hD2qS -->
  - `path` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:1kkgb2vD -->
  - `role` — [hypermedia-role](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-role) <!-- id:rR-UJPdL -->
  - `label` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:vvjLBzH9 -->

# Depends on <!-- id:8jobVV8F -->

- [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) <!-- id:-Km-MHD- -->
- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:3nHrzASo -->
- [hypermedia-role](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-role) <!-- id:-FedhZti -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:C6Jjf4J4 -->
