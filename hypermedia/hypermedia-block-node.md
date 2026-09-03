---
name: Block node
summary: "A node of the document content tree: a Block plus its ordered child Block nodes. The recursion (children of the same type) expresses arbitrary nesting; a leaf s"
schemaDefinition: ipfs://bafyreice3numv4cq4d4rf25gjpbnyvyiynftgyzbqbjzgqmdy54jhnzxfi
---
A node of the document content tree: a Block plus its ordered child Block nodes. The recursion (children of the same type) expresses arbitrary nesting; a leaf simply omits children. <!-- id:_QEoHThv -->

This document describes the **hypermedia-block-node** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:4_Z0qDWP -->

# Shape <!-- id:RgXO3NxT -->

A **closed struct** with these fields: <!-- id:LM850y9F -->
  - `block` _(required)_ — [hypermedia-block](./hypermedia-block.md) <!-- id:SwY5yaNk -->
  - `children` — list of [hypermedia-block-node](./hypermedia-block-node.md) <!-- id:5Kul9cSX -->

# Depends on <!-- id:sFTXQt8U -->

- [hypermedia-block](./hypermedia-block.md) <!-- id:36MLJaY3 -->
