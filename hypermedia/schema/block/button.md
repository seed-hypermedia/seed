---
name: Button block
summary: A labelled button linking somewhere.
schemaDefinition: ipfs://bafyreihfea74dbyl363luscsntyz475yn25utk5ejmu4jibmjy3xm6p7cy
---
This document describes the **schema/block/button** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:4MIlhf71 -->

# Shape <!-- id:xGD5dY-c -->

**Extends** [schema/block/base](./base.md) with these added fields: <!-- id:CY2yoTm1 -->
  - `type` — `"Button"` <!-- id:6Nvnbcfu -->
  - `text` — [string](../string.md) <!-- id:1F063pXv -->
  - `link` _(required)_ — [string](../string.md) <!-- id:EESTSjCi -->
  - `attributes` — map { 4 fields } <!-- id:UxIYwOeL -->

# Depends on <!-- id:glOGR_U7 -->

- [schema/block/base](./base.md) <!-- id:_0hbglqH -->
- [schema/block/button-alignment](./button-alignment.md) <!-- id:W3GAkILw -->
- [schema/block/children-type](./children-type.md) <!-- id:ViB7NkN7 -->
- [any](../any.md) <!-- id:kQPzV4Nj -->
- [float](../float.md) <!-- id:rjjWap8S -->
- [string](../string.md) <!-- id:dcAn-Ks- -->
