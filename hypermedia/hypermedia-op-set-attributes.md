---
name: SetAttributes op
summary: Set attributes on a block, or document-level metadata when block is empty.
schemaDefinition: ipfs://bafyreifjgdalt4t3c2vbvqzziqgazztxklklijaqxqnopfqpdktvb43p34
---
This document describes the **hypermedia-op-set-attributes** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:pyCYTEeq -->

# Shape <!-- id:LAfbycov -->

A **closed struct** with these fields: <!-- id:t_VD1Nku -->
  - `type` _(required)_ — `string` enum: `SetAttributes` <!-- id:8RrVMKzp -->
  - `block` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:DNLUlw3V -->
  - `attrs` — list of [hypermedia-key-value](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-key-value) <!-- id:fYFXgIHc -->

# Depends on <!-- id:LkWlsBr_ -->

- [hypermedia-key-value](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-key-value) <!-- id:XnogVOLT -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:wW3E9OCx -->
