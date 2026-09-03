---
name: "Example: Person document"
summary: "A document that describes a person — the base document, refined so its metadata requires a `surname`. Illustrates the corrected model: a typed document schema e"
schemaDefinition: ipfs://bafyreiax6kgqiyvbmkssetnsh2uimndmxrwz7o5gwhm7tpodp4rqjtw6xu
---
A document that describes a person — the base document, refined so its metadata requires a `surname`. Illustrates the corrected model: a typed document schema extends hm://seed.hyper.media/document and constrains `metadata`. Referenced by other documents via `schema`, and by a directory via `childrenSchema`. <!-- id:axdEuJ33 -->

This document describes the **example-person-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:WdsUDf3r -->

# Shape <!-- id:bStR0Oxc -->

**Extends** [hypermedia-document](./hypermedia-document.md) with these added fields: <!-- id:Zw6v2bIk -->
  - `metadata` — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:Ol0rxiOr -->

# Depends on <!-- id:ZbLY5eTj -->

- [hypermedia-document](./hypermedia-document.md) <!-- id:7bov8S7- -->
- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:3rI0P7tP -->
- [string](./onyx-string.md) <!-- id:HGDaIkqh -->
