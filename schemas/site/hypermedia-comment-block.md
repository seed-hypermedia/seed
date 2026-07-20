---
name: "Comment block"
summary: "A comment content block: a Block extended with a recursive list of child comment blocks."
---

# Comment block

A comment content block: a Block extended with a recursive list of child comment blocks.


This document describes the **hypermedia-comment-block** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

**Extends** [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block) with these added fields:

- `children` — list of [hypermedia-comment-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-comment-block)

## Depends on

- [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)
