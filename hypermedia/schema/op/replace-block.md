---
name: ReplaceBlock op
summary: Replace the content of a block.
schemaDefinition: ipfs://bafyreibbtsmff4i7pyqxu3iyhzycez26rsy36f6vgkl22uvpn4gkahzmhq
---
This document describes the **schema/op/replace-block** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:W0uu_eZA -->

# Shape <!-- id:2s8VcML2 -->

A **closed struct** with these fields: <!-- id:Sym_gHmT -->
  - `type` _(required)_ — `"ReplaceBlock"` <!-- id:WO4CBI3C -->
  - `block` _(required)_ — type variable `⟨Block⟩` <!-- id:PobCzv9L -->

**Generic** over `⟨Block⟩` (default [block](../../block.md)). <!-- id:apzRnVg1 -->

# Depends on <!-- id:zX0Jjt30 -->

- [block](../../block.md) <!-- id:F5Wi39wT -->
