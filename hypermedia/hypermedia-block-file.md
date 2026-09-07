---
name: File block
summary: A file attachment, referenced by a URL.
schemaDefinition: ipfs://bafyreig3nuvworn2chq4czqo54wt4kc7yidwho5bij5zj3mnkel2b4akia
---
This document describes the **hypermedia-block-file** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NBx9Tnq9 -->

# Shape <!-- id:LvbrriHo -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:SuWQgFEy -->
  - `type` — `string` enum: `File` <!-- id:F3pQOCmC -->
  - `link` _(required)_ — [string](./hypermedia-string.md) <!-- id:64jUo2lD -->
  - `attributes` — map { 4 fields } <!-- id:0Ah1D5v4 -->

# Depends on <!-- id:nEr--yZq -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:3JyMNiV0 -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:twboh5V7 -->
- [any](./hypermedia-any.md) <!-- id:SbzddHuS -->
- [float](./hypermedia-float.md) <!-- id:LO7gu58X -->
- [string](./hypermedia-string.md) <!-- id:b8oDszzV -->
