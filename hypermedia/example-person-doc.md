---
name: "Example: Person document"
summary: "A document that describes a person — the base document, refined so its metadata requires a `surname`. Illustrates the corrected model: a typed document schema e"
schemaDefinition: ipfs://bafyreignh7w7zbiovbrqdln2nk3sjxapfbdk6rt65dznkjuctjii6redji
---
A document that describes a person — the base document, refined so its metadata requires a `surname`. Illustrates the corrected model: a typed document schema extends hm://seed.hyper.media/document and constrains `metadata`. Referenced by other documents via `schema`, and by a directory via `childrenSchema`. <!-- id:axdEuJ33 -->

This document describes the **example-person-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:WdsUDf3r -->

# Shape <!-- id:bStR0Oxc -->
**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) with these added fields: <!-- id:Zw6v2bIk -->
  - `metadata` — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:Ol0rxiOr -->

# Depends on <!-- id:ZbLY5eTj -->
- [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) <!-- id:7bov8S7- -->
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:3rI0P7tP -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:HGDaIkqh -->