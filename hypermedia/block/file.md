---
name: File Block
summary: A file attachment, referenced by a URL.
schemaDefinition: ipfs://bafyreigp5y7uvooijtkyml2uogwlf6lsmdoje22sp6gnas2nfmjhwvdxru
---
This document describes the **block/file** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NBx9Tnq9 -->

# Shape <!-- id:LvbrriHo -->

**Extends** [block/base](./base.md) with these added fields: <!-- id:SuWQgFEy -->
  - `type` — `"File"` <!-- id:F3pQOCmC -->
  - `link` _(required)_ — [string](../string.md) <!-- id:64jUo2lD -->
  - `attributes` — map { 4 fields } <!-- id:0Ah1D5v4 -->

# Depends on <!-- id:nEr--yZq -->

- [block/base](./base.md) <!-- id:3JyMNiV0 -->
- [block/children-type](./children-type.md) <!-- id:twboh5V7 -->
- [any](../any.md) <!-- id:SbzddHuS -->
- [float](../float.md) <!-- id:LO7gu58X -->
- [string](../string.md) <!-- id:b8oDszzV -->
