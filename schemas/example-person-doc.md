---
name: "Person document"
summary: "A document that describes a person — the base document, refined so its metadata requires a `surname`. Illustrates the corrected model: a typed document schema e"
---

# Person document

A document that describes a person — the base document, refined so its metadata requires a `surname`. Illustrates the corrected model: a typed document schema extends hm://seed.hyper.media/document and constrains `metadata`. Referenced by other documents via `schema`, and by a directory via `childrenSchema`.


This document describes the **example-person-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) with these added fields:

- `metadata` — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata)

## Depends on

- [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document)
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata)
- [onyx-string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-string)
