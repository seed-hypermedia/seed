---
name: Math Block
summary: A block of LaTeX/KaTeX math.
schemaDefinition: ipfs://bafyreic7c7zfgzxwwsz32ykzs5bb3g3ubmf62pxqfyka6jtok2vr4g7oeq
---
This document describes the **schema/block/math** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:usrj-I7W -->

# Shape <!-- id:aWWfkPD5 -->

**Extends** [schema/block/base](./base.md) with these added fields: <!-- id:SBltfmzC -->
  - `type` — `"Math"` <!-- id:svQxxVDN -->
  - `text` — [string](../string.md) <!-- id:Fn40dsDZ -->
  - `attributes` — map { 2 fields } <!-- id:9xuaTSwI -->

# Depends on <!-- id:2UNOf9xM -->

- [schema/block/base](./base.md) <!-- id:LayK8q5D -->
- [schema/block/children-type](./children-type.md) <!-- id:nMsh63jO -->
- [any](../any.md) <!-- id:Pte3s6Aa -->
- [float](../float.md) <!-- id:iP9RpaYy -->
- [string](../string.md) <!-- id:CfYrEM4W -->
