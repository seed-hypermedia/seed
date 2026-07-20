---
name: "ReplaceBlock op"
summary: "Replace the content of a block."
---

# ReplaceBlock op

Replace the content of a block.


This document describes the **hypermedia-op-replace-block** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `type` *(required)* — `string` enum: `ReplaceBlock`
- `block` *(required)* — type variable `⟨Block⟩`

**Generic** over `⟨Block⟩` (default [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)).

## Depends on

- [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)
