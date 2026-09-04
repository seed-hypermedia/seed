---
name: Math block
summary: A block of LaTeX/KaTeX math.
schemaDefinition: ipfs://bafyreianxdgaemva37x6b6ft7y7qyzviyds46cr5jqfl7zz2wcrw4ri45i
---
This document describes the **hypermedia-block-math** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:usrj-I7W -->

# Shape <!-- id:aWWfkPD5 -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:SBltfmzC -->
  - `type` — `string` enum: `Math` <!-- id:svQxxVDN -->
  - `text` — [string](./onyx-string.md) <!-- id:Fn40dsDZ -->
  - `attributes` — map { 2 fields } <!-- id:9xuaTSwI -->

# Depends on <!-- id:2UNOf9xM -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:LayK8q5D -->
- [hypermedia-children-type](./hypermedia-children-type.md) <!-- id:nMsh63jO -->
- [any](./onyx-any.md) <!-- id:Pte3s6Aa -->
- [float](./onyx-float.md) <!-- id:iP9RpaYy -->
- [string](./onyx-string.md) <!-- id:CfYrEM4W -->
