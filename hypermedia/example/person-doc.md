---
name: "Example: Person Document"
summary: "A document that describes a person — the base document, refined so its metadata requires a `surname`. Illustrates the corrected model: a typed document schema e"
schemaDefinition: ipfs://bafyreia5elcawcriihs6ymri3ts7p2ibsmdetkkwk6ouvwwahtj4md5ro4
---
A document that describes a person — the base document, refined so its metadata requires a `surname`. Illustrates the corrected model: a typed document schema extends hm://seed.hyper.media/document and constrains `metadata`. Referenced by other documents via `schema`, and by a directory via `childrenSchema`. <!-- id:axdEuJ33 -->

This document describes the **example/person-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:WdsUDf3r -->

# Shape <!-- id:bStR0Oxc -->

**Extends** [document](../document.md) with these added fields: <!-- id:Zw6v2bIk -->
  - `metadata` — [metadata](../metadata.md) <!-- id:Ol0rxiOr -->

# Depends on <!-- id:ZbLY5eTj -->

- [document](../document.md) <!-- id:7bov8S7- -->
- [metadata](../metadata.md) <!-- id:3rI0P7tP -->
- [string](../string.md) <!-- id:HGDaIkqh -->
