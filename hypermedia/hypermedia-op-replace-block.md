---
name: ReplaceBlock op
summary: Replace the content of a block.
schemaDefinition: ipfs://bafyreifcy5ljkmr3alhjkyu47ma4ggkoa5bvfgn3czx7qqjkydgmqmaepu
---
This document describes the **hypermedia-op-replace-block** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:W0uu_eZA -->

# Shape <!-- id:2s8VcML2 -->

A **closed struct** with these fields: <!-- id:Sym_gHmT -->
  - `type` _(required)_ — `string` enum: `ReplaceBlock` <!-- id:WO4CBI3C -->
  - `block` _(required)_ — type variable `⟨Block⟩` <!-- id:PobCzv9L -->

**Generic** over `⟨Block⟩` (default [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)). <!-- id:apzRnVg1 -->

# Depends on <!-- id:zX0Jjt30 -->

- [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block) <!-- id:F5Wi39wT -->
