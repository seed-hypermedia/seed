---
name: File block
summary: A file attachment, referenced by a URL.
schemaDefinition: ipfs://bafyreidc4ixnykgyp2juyqewrni3l3oert6ccaqrs3i3pwa3zjyluoao6e
---
This document describes the **hypermedia-block-file** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NBx9Tnq9 -->

# Shape <!-- id:LvbrriHo -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:SuWQgFEy -->
  - `type` — `string` enum: `File` <!-- id:F3pQOCmC -->
  - `link` _(required)_ — [string](./onyx-string.md) <!-- id:64jUo2lD -->
  - `attributes` — map { 4 fields } <!-- id:0Ah1D5v4 -->

# Depends on <!-- id:nEr--yZq -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:3JyMNiV0 -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:twboh5V7 -->
- [any](./onyx-any.md) <!-- id:SbzddHuS -->
- [float](./onyx-float.md) <!-- id:LO7gu58X -->
- [string](./onyx-string.md) <!-- id:b8oDszzV -->
