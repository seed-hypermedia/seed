---
name: "Block node"
summary: "A node of the document content tree: a Block plus its ordered child Block nodes. The recursion (children of the same type) expresses arbitrary nesting; a leaf s"
---

# Block node

A node of the document content tree: a Block plus its ordered child Block nodes. The recursion (children of the same type) expresses arbitrary nesting; a leaf simply omits children.


This document describes the **hypermedia-block-node** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `block` *(required)* — [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)
- `children` — list of [hypermedia-block-node](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block-node)

## Depends on

- [hypermedia-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-block)
